/**
 * 服务端行情代理：统一负责第三方市场数据（OKX / Binance）的拉取。
 *
 * 设计要点（对应《证据使用规则》与《产品规格》的要求）：
 * - 超时：AbortSignal.timeout，避免接口挂死拖垮页面。
 * - 缓存：内存 TTL 缓存，短时间重复请求不出网。
 * - 限流：按 host 做最小间隔，避免刷第三方。
 * - 降级：任何第三方失败都返回结构化结果，绝不抛异常导致页面白屏。
 */
import type { Candle } from './types';

const OKX_BASE = 'https://www.okx.com';
const BINANCE_BASE = 'https://fapi.binance.com';

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

export const OKX_TIMEOUT_MS = 8000;
export const BINANCE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 60_000;

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

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  // 并发去重：同一 URL 的进行中请求共享同一个 promise，避免同 host 重复连网。
  const inFlight = inflight.get(url);
  if (inFlight) return inFlight;

  const p = (async () => {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      return await res.json();
    } catch (err) {
      const e = err as Error;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new Error('timeout');
      if (e?.message?.startsWith('http_')) throw e;
      // 其余（DNS 失败、连接重置、fetch failed 等）统一归为网络不可用
      throw new Error('network_error');
    } finally {
      inflight.delete(url);
    }
  })();

  inflight.set(url, p);
  return p;
}

export interface OkxCandles {
  instId: string;
  bar: string;
  candles: Candle[]; // 升序
  until: number | null; // 最后一根已收盘 K 线的 ts（用于 freshness）
}

/** 拉取 OKX 永续合约 K 线（升序，仅保留已收盘的未成熟 K 线由调用方决定）。 */
export async function getOkxCandles(
  coin: Coin,
  bar: string,
  limit = 200,
): Promise<OkxCandles> {
  const instId = OKX_INST[coin];
  const url = `${OKX_BASE}/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${limit}`;
  const key = `candles:${instId}:${bar}:${limit}`;
  const hit = cacheGet<OkxCandles>(key);
  if (hit) return hit;

  const body = (await fetchJson(url, OKX_TIMEOUT_MS)) as { code: string; data: string[][] };
  if (!body || body.code !== '0' || !Array.isArray(body.data)) {
    throw new Error('okx_bad_response');
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

  const result: OkxCandles = {
    instId,
    bar,
    candles: rows,
    until: rows.length ? rows.at(-1)!.ts : null,
  };
  cacheSet(key, result);
  return result;
}

export interface OkxTickers {
  [coin: string]: { last: number; ts: number } | undefined;
}

/** 拉取现货/永续最新价（用于头部概览的实时价格与涨跌）。 */
export async function getOkxTickers(coins: Coin[]): Promise<OkxTickers> {
  const out: OkxTickers = {};
  await Promise.all(
    coins.map(async (coin) => {
      const instId = OKX_INST[coin];
      const url = `${OKX_BASE}/api/v5/market/ticker?instId=${instId}`;
      const key = `ticker:${instId}`;
      const hit = cacheGet<{ last: number; ts: number }>(key);
      if (hit) {
        out[coin] = hit;
        return;
      }
      const body = (await fetchJson(url, OKX_TIMEOUT_MS)) as { code: string; data: { last: string; ts: string }[] };
      if (!body || body.code !== '0' || !body.data?.length) throw new Error('okx_bad_response');
      const last = Number(body.data[0].last);
      const ts = Number(body.data[0].ts);
      const v = { last, ts };
      cacheSet(key, v);
      out[coin] = v;
    }),
  );
  return out;
}

export interface FundingPoint {
  ts: number;
  rate: number; // 原始比例（未乘 100）
}

/** 拉取 Binance 永续资金费率（升序）。 */
export async function getBinanceFunding(coin: 'PEPE' | 'DOGE', limit = 30): Promise<FundingPoint[]> {
  const symbol = BINANCE_SYMBOL[coin];
  const url = `${BINANCE_BASE}/fapi/v1/fundingRate?symbol=${symbol}&limit=${limit}`;
  const key = `funding:${symbol}:${limit}`;
  const hit = cacheGet<FundingPoint[]>(key);
  if (hit) return hit;

  const body = (await fetchJson(url, BINANCE_TIMEOUT_MS)) as {
    fundingTime: number;
    fundingRate: string;
  }[];
  if (!Array.isArray(body)) throw new Error('binance_bad_response');
  const rows = body
    .map((r) => ({ ts: Number(r.fundingTime), rate: Number(r.fundingRate) }))
    .filter((r) => Number.isFinite(r.ts) && Number.isFinite(r.rate))
    .sort((a, b) => a.ts - b.ts);
  cacheSet(key, rows);
  return rows;
}