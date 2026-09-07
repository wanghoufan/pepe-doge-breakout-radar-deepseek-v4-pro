/**
 * 服务端行情代理：统一负责第三方市场数据（OKX / Binance）的拉取。
 *
 * 设计要点：
 * - 只由服务端发起请求（浏览器永远不直连交易所），规避 CORS 与密钥暴露。
 * - OKX 公开行情接口不需要 API Key，严禁要求用户提供任何密钥。
 * - 每次请求都产出结构化诊断 `FetchDiag`：真实请求地址、HTTP 状态码、
 *   OKX 业务 code/msg、DNS/网络错误、超时、耗时。诊断可被 /api/market/health 原样输出。
 * - 超时：AbortSignal.timeout，避免接口挂死拖垮页面。
 * - 缓存：内存 TTL 缓存，短时间重复请求不出网。
 * - 限流/去重：同一 URL 的进行中请求共享同一个 promise。
 * - 独立降级：OKX 与 Binance 各自成败互不影响，由编排层决定整体状态。
 * - 绝不返回模拟数据：失败就是失败，诊断说清楚原因。
 */
import type { Candle } from './types';

/** OKX 官方公开域名列表，按顺序尝试；前面的域名在某些地域被墙时自动回退。 */
const OKX_HOSTS = ['https://www.okx.com', 'https://aws.okx.com'];
const BINANCE_HOSTS = ['https://fapi.binance.com', 'https://fapi1.binance.com'];

const OKX_INST = {
  PEPE: 'PEPE-USDT-SWAP',
  DOGE: 'DOGE-USDT-SWAP',
  BTC: 'BTC-USDT-SWAP',
} as const;

const BINANCE_SYMBOL = {
  PEPE: '1000PEPEUSDT',
  DOGE: 'DOGEUSDT',
} as const;

export type Coin = 'PEPE' | 'DOGE' | 'BTC';
export type FundingCoin = 'PEPE' | 'DOGE';

export const OKX_TIMEOUT_MS = 8000;
export const BINANCE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

export type ErrorKind = 'timeout' | 'dns' | 'network' | 'http_status' | 'bad_body' | 'none';

export interface FetchDiag {
  /** 实际发起请求的完整地址（含 query）。 */
  url: string;
  host: string;
  /** HTTP 状态码；请求未建立连接时为 null。 */
  httpStatus: number | null;
  /** 交易所业务码（OKX：code；Binance：HTTP 错误码或 -1）。 */
  vendorCode: string | null;
  vendorMsg: string | null;
  /** 错误归类：none 表示成功。 */
  errorKind: ErrorKind;
  /** 原始错误信息（DNS 报错、fetch failed、超时等）。 */
  errorDetail: string | null;
  /** 是否命中内存缓存。 */
  cached: boolean;
  durationMs: number;
  /** 本次尝试过的所有地址（含失败域名）。 */
  attempts: { url: string; errorKind: ErrorKind; httpStatus: number | null; vendorCode: string | null; detail: string | null }[];
}

export type Result<T> =
  | { ok: true; data: T; diag: FetchDiag }
  | { ok: false; error: string; diag: FetchDiag };

interface CacheEntry {
  at: number;
  data: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const e = cache.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return e.data as T;
}

function cacheSet(key: string, data: unknown) {
  cache.set(key, { at: Date.now(), data });
}

function classify(err: unknown): { errorKind: ErrorKind; detail: string; httpStatus: number | null } {
  const e = err as Error & { cause?: unknown };
  const name = e?.name ?? '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { errorKind: 'timeout', detail: `请求超时（${e.message}）`, httpStatus: null };
  }
  if (e?.message?.startsWith('http_')) {
    return {
      errorKind: 'http_status',
      detail: `HTTP ${e.message.slice(5)}`,
      httpStatus: Number(e.message.slice(5)) || null,
    };
  }
  const cause = e?.cause as { code?: string; message?: string } | undefined;
  const code = cause?.code;
  const raw = [e?.message, cause?.message].filter(Boolean).join(' / ') || 'unknown';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(raw)) {
    return { errorKind: 'dns', detail: `DNS 解析失败：${raw}`, httpStatus: null };
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE' || code === 'ETIMEDOUT') {
    return { errorKind: 'network', detail: `网络连接失败（${code}）：${raw}`, httpStatus: null };
  }
  return { errorKind: 'network', detail: raw, httpStatus: null };
}

/** 单个地址的 JSON 拉取，返回原始 body 或抛出可归类错误。 */
async function fetchOnce(url: string, timeoutMs: number): Promise<unknown> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return await res.json();
}

/**
 * 依次尝试多个官方域名，任一成功即返回。
 * 返回 { data, attempts }，全部失败时 attempts 里保留每一个域名的真实错误。
 */
async function fetchWithFallback(
  path: string,
  hosts: string[],
  timeoutMs: number,
  cacheKey: string,
): Promise<Result<unknown>> {
  const started = Date.now();
  const hit = cacheGet<unknown>(cacheKey);
  if (hit !== undefined) {
    return {
      ok: true,
      data: hit,
      diag: {
        url: `${hosts[0]}${path}`,
        host: new URL(hosts[0]).host,
        httpStatus: 200,
        vendorCode: null,
        vendorMsg: null,
        errorKind: 'none',
        errorDetail: null,
        cached: true,
        durationMs: Date.now() - started,
        attempts: [],
      },
    };
  }

  const inFlight = inflight.get(cacheKey);
  if (inFlight) {
    const shared = (await inFlight) as Result<unknown>;
    return { ...shared, diag: { ...shared.diag, cached: true } };
  }

  const task = (async (): Promise<Result<unknown>> => {
    const attempts: FetchDiag['attempts'] = [];
    for (const host of hosts) {
      const url = `${host}${path}`;
      const t0 = Date.now();
      try {
        const data = await fetchOnce(url, timeoutMs);
        cacheSet(cacheKey, data);
        return {
          ok: true,
          data,
          diag: {
            url,
            host: new URL(host).host,
            httpStatus: 200,
            vendorCode: null,
            vendorMsg: null,
            errorKind: 'none',
            errorDetail: null,
            cached: false,
            durationMs: Date.now() - t0,
            attempts,
          },
        };
      } catch (err) {
        const c = classify(err);
        attempts.push({
          url,
          errorKind: c.errorKind,
          httpStatus: c.httpStatus,
          vendorCode: null,
          detail: c.detail,
        });
      }
    }
    const first = attempts[0]!;
    const last = attempts.at(-1)!;
    return {
      ok: false,
      error: last.errorKind === 'timeout' ? 'timeout' : `${last.errorKind}`,
      diag: {
        url: last.url,
        host: new URL(new URL(last.url).origin).host,
        httpStatus: first.httpStatus,
        vendorCode: null,
        vendorMsg: null,
        errorKind: last.errorKind,
        errorDetail: attempts.map((a) => `${a.url} → ${a.errorKind}${a.httpStatus ? `(${a.httpStatus})` : ''}：${a.detail}`).join(' | '),
        cached: false,
        durationMs: Date.now() - started,
        attempts,
      },
    };
  })();

  inflight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inflight.delete(cacheKey);
  }
}

export interface OkxCandles {
  instId: string;
  bar: string;
  /** 全部 K 线（含未收盘的盘中那根，升序）。 */
  candles: Candle[];
  /** 仅已收盘 K 线（判定突破的唯一依据，升序）。 */
  confirmedCandles: Candle[];
  /** 未收盘的盘中 K 线（仅展示，不参与任何判定）。 */
  intradayCandle: Candle | null;
  /** 最后一根已收盘 K 线的 ts。 */
  until: number | null;
  /** 行情实际抓取时间。 */
  fetchedAt: number;
}

/** 拉取 OKX 永续合约 K 线（升序）。confirmed 字段来自 OKX 返回的 confirm 位。 */
export async function getOkxCandles(coin: Coin, bar: string, limit = 200): Promise<Result<OkxCandles>> {
  const instId = OKX_INST[coin];
  const path = `/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const res = await fetchWithFallback(path, OKX_HOSTS, OKX_TIMEOUT_MS, `candles:${instId}:${bar}:${limit}`);
  if (!res.ok) return res;

  const body = res.data as { code?: string; msg?: string; data?: string[][] } | null;
  if (!body || body.code !== '0' || !Array.isArray(body.data)) {
    return {
      ok: false,
      error: 'okx_bad_response',
      diag: {
        ...res.diag,
        vendorCode: body?.code ?? null,
        vendorMsg: body?.msg ?? '响应体缺少 data',
        errorKind: 'bad_body',
        errorDetail: `OKX code=${body?.code ?? 'null'} msg=${body?.msg ?? 'null'}`,
      },
    };
  }

  const rows = body.data
    .map((r) => ({
      ts: Number(r[0]),
      o: Number(r[1]),
      h: Number(r[2]),
      l: Number(r[3]),
      c: Number(r[4]),
      vol: Number(r[5]),
      quoteVol: Number(r[7]),
      confirmed: r[8] === '1',
    }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.c))
    .sort((a, b) => a.ts - b.ts);

  const confirmedCandles = rows.filter((r) => r.confirmed);
  // OKX 返回结果中 confirm=0 的那根是盘中未收盘 K 线（总是最新一根）。
  const intradayCandle = rows.length && !rows.at(-1)!.confirmed ? rows.at(-1)! : null;

  const data: OkxCandles = {
    instId,
    bar,
    candles: rows,
    confirmedCandles,
    intradayCandle,
    until: confirmedCandles.length ? confirmedCandles.at(-1)!.ts : null,
    fetchedAt: Date.now(),
  };
  return { ok: true, data, diag: res.diag };
}

export type OkxTickers = Partial<Record<Coin, { last: number; ts: number }>>;

/** 拉取 OKX 永续最新价（用于实时价格与涨跌）。 */
export async function getOkxTickers(coins: Coin[]): Promise<Result<OkxTickers>> {
  const started = Date.now();
  const out: OkxTickers = {};
  const attempts: FetchDiag['attempts'] = [];
  let lastDiag: FetchDiag | null = null;
  let failed = 0;

  await Promise.all(
    coins.map(async (coin) => {
      const instId = OKX_INST[coin];
      const path = `/api/v5/market/ticker?instId=${instId}`;
      const res = await fetchWithFallback(path, OKX_HOSTS, OKX_TIMEOUT_MS, `ticker:${instId}`);
      lastDiag = res.diag;
      attempts.push(...res.diag.attempts);
      if (!res.ok) {
        failed += 1;
        return;
      }
      const body = res.data as { code?: string; msg?: string; data?: { last: string; ts: string }[] } | null;
      if (!body || body.code !== '0' || !body.data?.length) {
        failed += 1;
        attempts.push({
          url: res.diag.url,
          errorKind: 'bad_body',
          httpStatus: res.diag.httpStatus,
          vendorCode: body?.code ?? null,
          detail: `OKX code=${body?.code ?? 'null'} msg=${body?.msg ?? '空 data'}`,
        });
        return;
      }
      out[coin] = { last: Number(body.data[0].last), ts: Number(body.data[0].ts) };
    }),
  );

  const base: FetchDiag = lastDiag ?? {
    url: `${OKX_HOSTS[0]}/api/v5/market/ticker`,
    host: new URL(OKX_HOSTS[0]).host,
    httpStatus: null,
    vendorCode: null,
    vendorMsg: null,
    errorKind: 'none',
    errorDetail: null,
    cached: false,
    durationMs: Date.now() - started,
    attempts,
  };

  if (failed === coins.length) {
    return {
      ok: false,
      error: 'okx_ticker_failed',
      diag: { ...base, errorKind: 'network', errorDetail: base.errorDetail ?? 'ticker 全部失败' },
    };
  }

  return {
    ok: true,
    data: out,
    diag: {
      ...base,
      errorKind: failed > 0 ? 'http_status' : 'none',
      errorDetail: failed > 0 ? `${failed}/${coins.length} 个标的 ticker 失败` : null,
      attempts,
      durationMs: Date.now() - started,
    },
  };
}

export interface FundingPoint {
  ts: number;
  rate: number; // 原始比例（未乘 100）
}

export interface FundingResult {
  symbol: string;
  points: FundingPoint[];
  /** 真实来源：binance 或 okx（okx 为 Binance 不可用时的实时兜底，非快照）。 */
  provider: 'binance' | 'okx';
}

/** 拉取 Binance 永续资金费率（升序）。 */
export async function getBinanceFunding(coin: FundingCoin, limit = 30): Promise<Result<FundingPoint[]>> {
  const symbol = BINANCE_SYMBOL[coin];
  const path = `/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`;
  const res = await fetchWithFallback(path, BINANCE_HOSTS, BINANCE_TIMEOUT_MS, `funding:binance:${symbol}:${limit}`);
  if (!res.ok) return res;

  const body = res.data as { fundingTime: number; fundingRate: string }[] | { code?: number; msg?: string } | null;
  if (!Array.isArray(body)) {
    return {
      ok: false,
      error: 'binance_bad_response',
      diag: {
        ...res.diag,
        vendorCode: String((body as { code?: number } | null)?.code ?? -1),
        vendorMsg: (body as { msg?: string } | null)?.msg ?? '响应体不是数组',
        errorKind: 'bad_body',
        errorDetail: `Binance 返回非数组：${JSON.stringify(body).slice(0, 200)}`,
      },
    };
  }
  const rows = body
    .map((r) => ({ ts: Number(r.fundingTime), rate: Number(r.fundingRate) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.rate))
    .sort((a, b) => a.ts - b.ts)
    .slice(-limit);
  return { ok: true, data: rows, diag: res.diag };
}

/** 拉取 OKX 永续资金费率（升序，用于 Binance 不可用时的实时兜底）。 */
export async function getOkxFunding(coin: FundingCoin, limit = 30): Promise<Result<FundingPoint[]>> {
  const instId = OKX_INST[coin];
  const path = `/api/v5/public/funding-rate?instId=${instId}&limit=${limit}`;
  const res = await fetchWithFallback(path, OKX_HOSTS, OKX_TIMEOUT_MS, `funding:okx:${instId}:${limit}`);
  if (!res.ok) return res;

  const body = res.data as
    | { code?: string; msg?: string; data?: { fundingTime: string; realizedRate: string }[] }
    | null;
  if (!body || body.code !== '0' || !Array.isArray(body.data)) {
    return {
      ok: false,
      error: 'okx_bad_response',
      diag: {
        ...res.diag,
        vendorCode: body?.code ?? null,
        vendorMsg: body?.msg ?? '响应体缺少 data',
        errorKind: 'bad_body',
        errorDetail: `OKX code=${body?.code ?? 'null'} msg=${body?.msg ?? 'null'}`,
      },
    };
  }
  const rows = body.data
    .map((r) => ({ ts: Number(r.fundingTime), rate: Number(r.realizedRate) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.rate))
    .sort((a, b) => a.ts - b.ts)
    .slice(-limit);
  return { ok: true, data: rows, diag: res.diag };
}

/**
 * 资金费率：Binance 优先，失败则自动切到 OKX（同为交易所实时公开数据，不掺快照）。
 * 两者都失败时返回 ok:false，并保留两条链路的完整诊断。
 */
export async function getFunding(coin: FundingCoin, limit = 30): Promise<Result<FundingResult>> {
  const binance = await getBinanceFunding(coin, limit);
  if (binance.ok && binance.data.length) {
    return {
      ok: true,
      data: { symbol: BINANCE_SYMBOL[coin], points: binance.data, provider: 'binance' },
      diag: binance.diag,
    };
  }
  const binanceError = binance.ok ? '返回空数据' : binance.error;
  const binanceDetail = binance.ok ? 'Binance 返回 0 条' : (binance.diag.errorDetail ?? binance.error);

  const okx = await getOkxFunding(coin, limit);
  if (okx.ok && okx.data.length) {
    return {
      ok: true,
      data: { symbol: OKX_INST[coin], points: okx.data, provider: 'okx' },
      diag: okx.diag,
    };
  }
  const okxError = okx.ok ? '返回空数据' : okx.error;
  const okxDetail = okx.ok ? 'OKX 返回 0 条' : (okx.diag.errorDetail ?? okx.error);

  return {
    ok: false,
    error: 'funding_unavailable',
    diag: {
      url: `${binance.diag.url} || ${okx.diag.url}`,
      host: `${binance.diag.host} || ${okx.diag.host}`,
      httpStatus: binance.diag.httpStatus ?? okx.diag.httpStatus,
      vendorCode: okx.diag.vendorCode ?? null,
      vendorMsg: okx.diag.vendorMsg ?? null,
      errorKind: okx.diag.errorKind === 'none' ? binance.diag.errorKind : okx.diag.errorKind,
      errorDetail: `Binance: ${binanceError}（${binanceDetail}） || OKX: ${okxError}（${okxDetail}）`,
      cached: false,
      durationMs: binance.diag.durationMs + okx.diag.durationMs,
      attempts: [...binance.diag.attempts, ...okx.diag.attempts],
    },
  };
}

export const MARKET_META = {
  OKX_INST,
  BINANCE_SYMBOL,
  OKX_HOSTS,
  BINANCE_HOSTS,
} as const;
