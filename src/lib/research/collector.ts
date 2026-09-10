/**
 * P0 前向采集器（forward collector）：按冻结 cadence 定时采集 → research store。
 *
 * 冻结依据：`research/source-probe/SOURCE_CADENCE_BASELINE_V1.md` v1.0-FROZEN。
 * - `collector_poll` FROZEN **60s**（§1）：本采集器节拍固定 60s，顺序 sweep（禁自制造并发限流）。
 * - 仅 FROZEN 项可代入 freshness 判定；§7 六项 limitation 禁代入：
 *   R-1 recovery 全行 PROVISIONAL-UNVERIFIED（本采集器不声明任何恢复路径已验证）；
 *   T-1 OKX trades 心跳阈值未定（不发明 ping 阈值，只用 transport 存活 + 连续失败计数）；
 *   W-1 Binance WS 本站点零推送（本采集器只用 REST，禁依赖 WS）；
 *   D-1 depth freshness UNMAPPED（depth 数据照存，freshness 诚实记 unavailable，禁自定映射）；
 *   F-1 OKX funding event-age 不适用（未来 dating，只走 heartbeat 路径）；
 *   M-1 OKX mark 400/800ms 为机械值（REST 路径用 60s 上界，禁把 WS 节拍值代入 REST 判定）。
 * - 探针（`research/source-probe/`）不动：本采集器不 import 探针、不改探针文件、不复用探针进程。
 * - 实时 Action 隔离：实时链路（market-service / v2/engine / action）禁 import 本模块
 *   （见 `isolation.ts` FORBIDDEN_MODULE_FRAGMENTS，含 `research/collector`）；
 *   反向亦然——本模块只 import `research/` 内模块，禁 import `../config` /
 *   `../market-client` / `../market-service`（registry 解耦快照自持，symbol 经
 *   registry 读取，禁硬编码、禁穿透业务配置）。
 * - 范围冻结：标的仅 PEPE / DOGE / ETHFI + BTC（环境参照）；交易所仅 okx / binance。
 *   BTC 无资金费率基线（基线 §2 N/A），不采 funding。禁 Bybit / CoinGlass（含常量）。
 * - 双时间戳：每条记录保留 `event_time_ms`（交易所源时间）+ `receive_time_ms`
 *   （本端收到时间），禁拿抓取时间冒充市场时间。
 * - 失败建异常事件：任一 target 失败即写一条 `field='reliability'` 异常记录
 *   （UNAVAILABLE + error_code + 起止 ts 在 source_diag），禁静默。
 * - Quant NONE：无权重、无评分、无阈值调参、无胜率/收益输出。
 */

import {
  canonicalizePrice,
  canonicalizeQty,
  lookupInstrument,
  type SymbolNorm,
  type VenueExchange,
} from './instrument-registry';
import { INSTRUMENT_REGISTRY_VERSION } from './instrument-registry';
import { assessFieldFreshness, freshnessToReliability } from './field-freshness';
import { buildDedupKey, DedupStore, ingestBatch } from './ingest';
import { makeRecord, validateRecord, type ResearchRecord } from './schema';
import { normalizeBinanceOi, normalizeOkxOi, toPriceTriple } from './venue-adapters';
import { RawStore, ResearchStore } from './store';

/** FROZEN（基线 §1）：REST 全扫节拍 60s。 */
export const COLLECTOR_POLL_MS = 60_000;
/** 采集器版本（写入记录 collector_version，覆盖 schema 默认的 collector-p0.1.0）。 */
export const FORWARD_COLLECTOR_VERSION = 'collector-fwd1.0.0';
/** 单 target 超时（与探针同口径 8s）。 */
export const TARGET_TIMEOUT_MS = 8_000;
/** trades 明细上限（与探针 limit=100 同口径）。 */
export const TRADE_LIMIT = 100;
/** depth 档位（与探针 sz=20/limit=20 同口径）。 */
export const DEPTH_LIMIT = 20;

export type FwdCoin = 'PEPE' | 'DOGE' | 'ETHFI' | 'BTC';
export const FWD_COINS: readonly FwdCoin[] = ['PEPE', 'DOGE', 'ETHFI', 'BTC'];
/** funding 仅交易标的（BTC 按产品语义无资金费率基线，基线 §2 N/A）。 */
export const FWD_FUNDING_COINS: readonly FwdCoin[] = ['PEPE', 'DOGE', 'ETHFI'];

export type FwdChannel = 'oi' | 'trades' | 'mark' | 'index' | 'funding_current' | 'depth';

export interface FwdTarget {
  exchange: VenueExchange;
  channel: FwdChannel;
  coin: FwdCoin;
  path: string;
  hosts: string[];
}

const OKX_HOSTS = ['https://www.okx.com', 'https://aws.okx.com'];
const BINANCE_HOSTS = ['https://fapi.binance.com', 'https://fapi1.binance.com'];

function okxPath(coin: FwdCoin, channel: FwdChannel): string {
  const perp = lookupInstrument('okx', 'perp', coin as SymbolNorm)!.symbolRaw;
  const spot = lookupInstrument('okx', 'spot', coin as SymbolNorm)!.symbolRaw;
  switch (channel) {
    case 'oi':
      return `/api/v5/public/open-interest?instId=${perp}`;
    case 'trades':
      return `/api/v5/market/trades?instId=${perp}&limit=${TRADE_LIMIT}`;
    case 'mark':
      return `/api/v5/public/mark-price?instId=${perp}`;
    case 'index':
      // OKX 永续的指数为现货指数（同 underlying），经 registry spot 快照取 instId。
      return `/api/v5/market/index-tickers?instId=${spot}`;
    case 'funding_current':
      return `/api/v5/public/funding-rate?instId=${perp}&limit=5`;
    case 'depth':
      return `/api/v5/market/books?instId=${perp}&sz=${DEPTH_LIMIT}`;
  }
}

function binancePath(coin: FwdCoin, channel: FwdChannel): string {
  const s = lookupInstrument('binance', 'perp', coin as SymbolNorm)!.symbolRaw;
  switch (channel) {
    case 'oi':
      return `/fapi/v1/openInterest?symbol=${s}`;
    case 'trades':
      return `/fapi/v1/aggTrades?symbol=${s}&limit=${TRADE_LIMIT}`;
    case 'mark':
    case 'index':
      // Binance premiumIndex 单次返回 markPrice + indexPrice（index 复用同一 target，不另发请求）。
      return `/fapi/v1/premiumIndex?symbol=${s}`;
    case 'funding_current':
      return `/fapi/v1/fundingRate?symbol=${s}&limit=5`;
    case 'depth':
      return `/fapi/v1/depth?symbol=${s}&limit=${DEPTH_LIMIT}`;
  }
}

/**
 * 全量采集目标（42 targets/sweep）：
 * PEPE/DOGE/ETHFI：每所 oi/trades/mark/depth（8）+ OKX index（1）+ 每所 funding（2）= 11；
 * BTC：每所 oi/trades/mark/depth（8）+ OKX index（1）= 9，无 funding。
 * Binance index 复用 mark 的 premiumIndex 响应，不计独立 target。
 */
export function buildForwardTargets(): FwdTarget[] {
  const out: FwdTarget[] = [];
  for (const coin of FWD_COINS) {
    for (const ch of ['oi', 'trades', 'mark', 'depth'] as const) {
      out.push({ exchange: 'okx', channel: ch, coin, path: okxPath(coin, ch), hosts: OKX_HOSTS });
      out.push({ exchange: 'binance', channel: ch, coin, path: binancePath(coin, ch), hosts: BINANCE_HOSTS });
    }
    out.push({ exchange: 'okx', channel: 'index', coin, path: okxPath(coin, 'index'), hosts: OKX_HOSTS });
    if ((FWD_FUNDING_COINS as readonly string[]).includes(coin)) {
      out.push({ exchange: 'okx', channel: 'funding_current', coin, path: okxPath(coin, 'funding_current'), hosts: OKX_HOSTS });
      out.push({ exchange: 'binance', channel: 'funding_current', coin, path: binancePath(coin, 'funding_current'), hosts: BINANCE_HOSTS });
    }
  }
  return out;
}

/* ---------------- 抓取层（自持 fetch + 双域名回退；不 import market-client） ---------------- */

export type ErrorKind = 'none' | 'timeout' | 'dns' | 'network' | 'http_status' | 'bad_body';

export interface FetchResult {
  ok: boolean;
  status: number | null;
  body: unknown;
  errorKind: ErrorKind;
  errorDetail: string | null;
  latencyMs: number;
  url: string;
  receiveTimeMs: number;
}

export type FetchJson = (url: string, timeoutMs: number) => Promise<{ status: number; body: unknown }>;

function classifyFetchError(err: unknown): { kind: ErrorKind; detail: string } {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const name = e?.name ?? '';
  const msg = e?.message ?? 'unknown';
  if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout', detail: `timeout: ${msg}` };
  if (msg.startsWith('http_')) return { kind: 'http_status', detail: msg };
  const code = (e?.cause as { code?: string } | undefined)?.code;
  const raw = [msg, (e?.cause as { message?: string } | undefined)?.message].filter(Boolean).join(' / ');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(raw)) return { kind: 'dns', detail: `dns: ${raw}` };
  return { kind: 'network', detail: raw.slice(0, 300) };
}

async function defaultFetchJson(url: string, timeoutMs: number): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`http_${res.status}`);
  return { status: res.status, body: (await res.json()) as unknown };
}

async function fetchTarget(t: FwdTarget, fetchJson: FetchJson): Promise<FetchResult> {
  const receiveTimeMs = Date.now();
  let lastErr = { kind: 'network' as ErrorKind, detail: 'no attempt' };
  let lastStatus: number | null = null;
  let lastUrl = `${t.hosts[0]}${t.path}`;
  for (const host of t.hosts) {
    const url = `${host}${t.path}`;
    lastUrl = url;
    const t0 = Date.now();
    try {
      const { status, body } = await fetchJson(url, TARGET_TIMEOUT_MS);
      return { ok: true, status, body, errorKind: 'none', errorDetail: null, latencyMs: Date.now() - t0, url, receiveTimeMs };
    } catch (err) {
      const c = classifyFetchError(err);
      lastErr = c;
      const m = /http_(\d+)/.exec(c.detail);
      lastStatus = m ? Number(m[1]) : null;
    }
  }
  return { ok: false, status: lastStatus, body: null, errorKind: lastErr.kind, errorDetail: lastErr.detail, latencyMs: Date.now() - receiveTimeMs, url: lastUrl, receiveTimeMs };
}

/* ---------------- 响应解析（源事件时间提取；无源 ts 即 bad_body） ---------------- */

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' || typeof v === 'number' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

export interface ParsedTarget {
  eventTimeMs: number | null;
  payload: unknown;
  vendorNote: string | null;
}

/** 提取源事件时间；null = 响应无可用源 ts（调用方记 bad_body 异常事件，禁编造）。 */
export function parseResponse(t: FwdTarget, body: unknown): ParsedTarget {
  try {
    if (t.exchange === 'okx') {
      const b = body as { code?: string; data?: Record<string, unknown>[] };
      if (!b || b.code !== '0' || !Array.isArray(b.data) || !b.data.length) return { eventTimeMs: null, payload: null, vendorNote: `okx code=${(b as { code?: unknown })?.code ?? 'null'}` };
      const d = b.data;
      switch (t.channel) {
        case 'oi':
          return { eventTimeMs: num(d[0]['ts']), payload: d[0], vendorNote: null };
        case 'trades': {
          const ts = d.map((r) => num(r['ts'])).filter((v): v is number => v != null);
          return { eventTimeMs: ts.length ? Math.max(...ts) : null, payload: d, vendorNote: null };
        }
        case 'mark':
          return { eventTimeMs: num(d[0]['ts']), payload: d[0], vendorNote: null };
        case 'index':
          return { eventTimeMs: num(d[0]['ts']), payload: d[0], vendorNote: 'okx-spot-index' };
        case 'funding_current': {
          // OKX 源 ts 为下一结算时刻（未来 dating，limitation F-1），照实透传，禁改写。
          const ts = d.map((r) => num(r['fundingTime'])).filter((v): v is number => v != null);
          return { eventTimeMs: ts.length ? Math.max(...ts) : null, payload: d, vendorNote: 'okx-future-dating' };
        }
        case 'depth':
          return { eventTimeMs: num(d[0]['ts']), payload: d[0], vendorNote: null };
      }
    } else {
      switch (t.channel) {
        case 'oi':
          return { eventTimeMs: num((body as { time?: unknown })?.time), payload: body, vendorNote: null };
        case 'trades': {
          const arr = body as { T?: unknown }[];
          if (!Array.isArray(arr) || !arr.length) return { eventTimeMs: null, payload: null, vendorNote: 'empty aggTrades' };
          const ts = arr.map((r) => num(r['T'])).filter((v): v is number => v != null);
          return { eventTimeMs: ts.length ? Math.max(...ts) : null, payload: arr, vendorNote: null };
        }
        case 'mark':
        case 'index':
          return { eventTimeMs: num((body as { time?: unknown })?.time), payload: body, vendorNote: null };
        case 'funding_current': {
          const arr = body as { fundingTime?: unknown }[];
          if (!Array.isArray(arr) || !arr.length) return { eventTimeMs: null, payload: null, vendorNote: 'empty fundingRate' };
          const ts = arr.map((r) => num(r['fundingTime'])).filter((v): v is number => v != null);
          return { eventTimeMs: ts.length ? Math.max(...ts) : null, payload: arr, vendorNote: null };
        }
        case 'depth':
          return { eventTimeMs: num((body as { T?: unknown })?.T), payload: body, vendorNote: null };
      }
    }
  } catch {
    return { eventTimeMs: null, payload: null, vendorNote: 'parse exception' };
  }
  return { eventTimeMs: null, payload: null, vendorNote: 'unknown channel' };
}

/* ---------------- 记录组装（schema 身份/单位/freshness/去重全字段） ---------------- */

export interface SweepContext {
  snapshotId: string;
  sweepStartMs: number;
  /** 同 sweep 内已解析的 Binance mark canonical（供 OI 转 notional；缺失则 OI 记 null，禁自算）。 */
  binanceMarkCanonical: Map<string, number>;
  /** 连续失败计数（按 exchange|channel|coin；heartbeat 降级用，不声明 recovery 已验证）。 */
  failStreaks: Map<string, number>;
}

function regKey(exchange: VenueExchange, coin: FwdCoin): { key: string; version: string; symbolRaw: string } {
  const e = lookupInstrument(exchange, 'perp', coin as SymbolNorm)!;
  return { key: e.key, version: INSTRUMENT_REGISTRY_VERSION, symbolRaw: e.symbolRaw };
}

function baseRecord(
  t: FwdTarget,
  ctx: SweepContext,
  field: string,
  valueRaw: number | string,
  valueNorm: number | null,
  eventTimeMs: number | null,
  receiveTimeMs: number,
  freshness: 'ok' | 'stale' | 'unavailable',
  errorCode: string | null,
  dedupKey: string,
  extra: Partial<ResearchRecord> = {},
): ResearchRecord {
  const { key, version, symbolRaw } = regKey(t.exchange, t.coin);
  const r = makeRecord({
    exchange: t.exchange,
    symbol_raw: symbolRaw,
    symbol_norm: t.coin as SymbolNorm,
    market_type: 'perp',
    instrument_registry_key: key,
    instrument_registry_version: version,
    field,
    value_raw: valueRaw,
    value_norm: valueNorm,
    event_time_ms: eventTimeMs,
    receive_time_ms: receiveTimeMs,
    channel: 'rest',
    snapshot_id: ctx.snapshotId,
    collector_version: FORWARD_COLLECTOR_VERSION,
    reliability: freshnessToReliability(freshness),
    cross_market: null,
    freshness,
    error_code: errorCode,
    is_backfill: false,
    dedup_key: dedupKey,
    ...extra,
  });
  const errs = validateRecord(r);
  if (errs.length) {
    throw new Error(`collector 组装记录非法（${t.exchange}|${t.channel}|${t.coin}|${field}）：${errs.join('; ')}`);
  }
  return r;
}

/**
 * 异常事件（失败禁静默）：
 * field='reliability'，value_norm=null（禁拿缺失当 0），reliability=UNAVAILABLE，
 * freshness=unavailable，error_code=分类错误码，event_time_ms=null（无源时间禁编造），
 * 起止 ts 与诊断进 source_diag。
 */
export function buildAnomalyRecord(
  t: FwdTarget,
  ctx: SweepContext,
  errorKind: ErrorKind,
  errorDetail: string | null,
  receiveTimeMs: number,
  url: string,
): ResearchRecord {
  const { key } = regKey(t.exchange, t.coin);
  const streak = (ctx.failStreaks.get(`${t.exchange}|${t.channel}|${t.coin}`) ?? 0) + 1;
  ctx.failStreaks.set(`${t.exchange}|${t.channel}|${t.coin}`, streak);
  return baseRecord(
    t,
    ctx,
    'reliability',
    errorKind,
    null,
    null,
    receiveTimeMs,
    'unavailable',
    errorKind,
    `${t.exchange}|${key}|anomaly:${ctx.snapshotId}:${t.channel}:${t.coin}`,
    {
      reliability: 'UNAVAILABLE',
      source_diag: {
        anomaly: true,
        target: `${t.exchange}|${t.channel}|${t.coin}`,
        url,
        errorDetail,
        failStreak: streak,
        sweepStartMs: ctx.sweepStartMs,
        receiveTimeMs,
        note: '前向采集失败异常事件（§6-8 口径雏形：含错误码+起止 ts；恢复路径未验证 R-1，不声明自恢复）',
      },
    },
  );
}

function resetStreak(ctx: SweepContext, t: FwdTarget): void {
  ctx.failStreaks.set(`${t.exchange}|${t.channel}|${t.coin}`, 0);
}

/** OI 记录（venue-aware：OKX 优先官方 oiUsd；Binance 经 registry × mark 转 notional）。 */
function buildOiRecords(t: FwdTarget, ctx: SweepContext, parsed: ParsedTarget, fr: FetchResult): ResearchRecord[] {
  const { key } = regKey(t.exchange, t.coin);
  const evt = parsed.eventTimeMs;
  if (t.exchange === 'okx') {
    const p = parsed.payload as { oi?: unknown; oiCcy?: unknown; oiUsd?: unknown };
    const n = normalizeOkxOi({ symbolNorm: t.coin as SymbolNorm, oi: (p.oi as string | number | null) ?? null, oiCcy: (p.oiCcy as string | null) ?? null, oiUsd: (p.oiUsd as string | number | null) ?? null, metadata: { url: fr.url } });
    const age = evt === null ? null : fr.receiveTimeMs - evt;
    const v = assessFieldFreshness({ field: 'oi', eventAgeMs: age, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: COLLECTOR_POLL_MS });
    return [
      baseRecord(t, ctx, 'oi_notional_usd', typeof n.oi_notional_usd === 'number' ? n.oi_notional_usd : String(p.oiUsd ?? p.oi ?? 'null'), n.oi_notional_usd, evt, fr.receiveTimeMs, v.freshness, n.oi_notional_usd === null ? 'oiUsd_missing' : null, buildDedupKey({ kind: 'oi', exchange: t.exchange, instrumentRegistryKey: key, nativeId: evt ?? `no-ts:${ctx.snapshotId}` }), {
        source_diag: { oi_native: n.oi_native, oi_native_unit: n.oi_native_unit, oiCcy: n.oiCcy, url: fr.url, latencyMs: fr.latencyMs, freshnessReason: v.reason, oiUsdMissingNote: n.oi_notional_usd === null ? '无官方 oiUsd，记 null（禁自算）' : null },
      }),
    ];
  }
  const p = parsed.payload as { openInterest?: unknown };
  const markCanonical = ctx.binanceMarkCanonical.get(t.coin) ?? null;
  const n = normalizeBinanceOi({ symbolNorm: t.coin as SymbolNorm, openInterest: (p.openInterest as string | number | null) ?? null, markCanonical, metadata: { url: fr.url } });
  const age = evt === null ? null : fr.receiveTimeMs - evt;
  const v = assessFieldFreshness({ field: 'oi', eventAgeMs: age, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: COLLECTOR_POLL_MS });
  return [
    baseRecord(t, ctx, 'oi_notional_usd', typeof n.oi_notional_usd === 'number' ? n.oi_notional_usd : String(p.openInterest ?? 'null'), n.oi_notional_usd, evt, fr.receiveTimeMs, v.freshness, n.oi_notional_usd === null ? 'oi_notional_missing' : null, buildDedupKey({ kind: 'oi', exchange: t.exchange, instrumentRegistryKey: key, nativeId: evt ?? `no-ts:${ctx.snapshotId}` }), {
      source_diag: { oi_native: n.oi_native, oi_native_unit: n.oi_native_unit, markCanonicalUsed: markCanonical, url: fr.url, latencyMs: fr.latencyMs, freshnessReason: v.reason, missingNote: n.oi_notional_usd === null ? 'mark 缺失或原生缺失，notional 记 null（禁自算、禁跨所复用 OKX 路径）' : null },
    }),
  ];
}

/** trades 明细记录（OKX side 直取；Binance m→taker 反转；qty/price 经 registry 归一）。 */
function buildTradeRecords(t: FwdTarget, ctx: SweepContext, parsed: ParsedTarget, fr: FetchResult): ResearchRecord[] {
  const { key } = regKey(t.exchange, t.coin);
  const entry = lookupInstrument(t.exchange, 'perp', t.coin as SymbolNorm)!;
  const streak = ctx.failStreaks.get(`${t.exchange}|${t.channel}|${t.coin}`) ?? 0;
  // R2 + T-1：transport 存活（本次成功）即 HEALTHY；心跳阈值未定，不发明 ping 阈值，
  // 仅连续失败≥2（基线实测 boundary 级 streak=2）记 heartbeatExpired。
  const v = assessFieldFreshness({ field: 'trades', eventAgeMs: null, transportAlive: true, heartbeatExpired: streak >= 2, resolvedCadenceMs: COLLECTOR_POLL_MS });
  const out: ResearchRecord[] = [];
  if (t.exchange === 'okx') {
    const rows = parsed.payload as { tradeId?: unknown; px?: unknown; sz?: unknown; side?: unknown; ts?: unknown }[];
    for (const r of rows.slice(0, TRADE_LIMIT)) {
      const tradeId = String(r.tradeId ?? '');
      if (!tradeId) continue;
      const sideRaw = typeof r.side === 'string' ? r.side.toLowerCase() : '';
      if (sideRaw !== 'buy' && sideRaw !== 'sell') continue;
      const priceNative = Number(r.px);
      const qtyNative = Number(r.sz);
      if (!Number.isFinite(priceNative) || priceNative <= 0 || !Number.isFinite(qtyNative) || qtyNative < 0) continue;
      const priceCanonical = canonicalizePrice(entry, priceNative);
      if (priceCanonical === null) continue;
      const ets = num(r.ts);
      out.push(
        baseRecord(t, ctx, 'trade', priceNative, priceCanonical, ets, fr.receiveTimeMs, v.freshness, null, buildDedupKey({ kind: 'trade', exchange: t.exchange, instrumentRegistryKey: key, nativeId: tradeId }), {
          ...toPriceTriple(t.exchange, 'perp', t.coin as SymbolNorm, priceNative),
          source_event_id: tradeId,
          source_diag: { side: sideRaw, qtyCanonical: qtyNative, qtyUnit: 'contracts-native-unconverted', priceCanonical, url: fr.url, freshnessReason: v.reason, qtyNote: 'OKX 合约张数→base 数量需 ctVal，本采集器不自乘，qty 按原生张数透传（taker 上卷 notional 仅所内可比，禁跨所比较）' },
        }),
      );
    }
    return out;
  }
  const rows = parsed.payload as { a?: unknown; p?: unknown; q?: unknown; T?: unknown; m?: unknown }[];
  for (const r of rows.slice(0, TRADE_LIMIT)) {
    const aggId = String((r.a as unknown) ?? '');
    if (!aggId) continue;
    const priceNative = Number(r.p);
    const qtyNative = Number(r.q);
    if (!Number.isFinite(priceNative) || priceNative <= 0 || !Number.isFinite(qtyNative) || qtyNative < 0) continue;
    const priceCanonical = canonicalizePrice(entry, priceNative);
    const qtyCanonical = canonicalizeQty(entry, qtyNative);
    if (priceCanonical === null || qtyCanonical === null) continue;
    // Binance m=true 表示买方为 maker → taker 为卖方。
    const side = (r.m as boolean) ? 'sell' : 'buy';
    const ets = num(r.T);
    out.push(
      baseRecord(t, ctx, 'trade', priceNative, priceCanonical, ets, fr.receiveTimeMs, v.freshness, null, buildDedupKey({ kind: 'trade', exchange: t.exchange, instrumentRegistryKey: key, nativeId: aggId }), {
        ...toPriceTriple(t.exchange, 'perp', t.coin as SymbolNorm, priceNative),
        source_event_id: aggId,
        source_diag: { side, qtyCanonical, qtyUnit: 'canonical-base', priceCanonical, aggMakerFlag: r.m, url: fr.url, freshnessReason: v.reason },
      }),
    );
  }
  return out;
}

/** mark/index 记录（REST 路径统一用 60s 上界；M-1 的 400/800ms 禁代入 REST 判定）。 */
function buildMarkRecords(t: FwdTarget, ctx: SweepContext, parsed: ParsedTarget, fr: FetchResult, fieldOverride?: 'mark_price' | 'index_price'): ResearchRecord[] {
  const { key } = regKey(t.exchange, t.coin);
  const evt = parsed.eventTimeMs;
  const age = evt === null ? null : fr.receiveTimeMs - evt;
  const v = assessFieldFreshness({ field: 'mark', eventAgeMs: age, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: COLLECTOR_POLL_MS });
  const push = (field: 'mark_price' | 'index_price', priceNative: number | null): ResearchRecord | null => {
    if (priceNative === null || !Number.isFinite(priceNative)) return null;
    const triple = toPriceTriple(t.exchange, 'perp', t.coin as SymbolNorm, priceNative);
    if (field === 'mark_price' && t.exchange === 'binance') {
      const entry = lookupInstrument('binance', 'perp', t.coin as SymbolNorm)!;
      const canonical = canonicalizePrice(entry, priceNative);
      if (canonical !== null) ctx.binanceMarkCanonical.set(t.coin, canonical);
    }
    return baseRecord(t, ctx, field, priceNative, triple.price_canonical, evt, fr.receiveTimeMs, v.freshness, null, `${t.exchange}|${key}|${field}:${evt ?? `no-ts:${ctx.snapshotId}`}`, {
      ...triple,
      source_diag: { url: fr.url, latencyMs: fr.latencyMs, freshnessReason: v.reason, cadenceNote: 'REST 路径按 collector_poll 60s 上界判定（M-1 400/800ms 为 WS 机械值，禁代入）' },
    });
  };
  if (t.exchange === 'okx') {
    const p = parsed.payload as { markPx?: unknown; idxPx?: unknown };
    const field = fieldOverride ?? (t.channel === 'index' ? 'index_price' : 'mark_price');
    const r = push(field, p[field === 'mark_price' ? 'markPx' : 'idxPx'] === undefined ? null : Number(p[field === 'mark_price' ? 'markPx' : 'idxPx']));
    return r ? [r] : [];
  }
  const p = parsed.payload as { markPrice?: unknown; indexPrice?: unknown };
  const out: ResearchRecord[] = [];
  const m = push('mark_price', p.markPrice === undefined ? null : Number(p.markPrice));
  const i = push('index_price', p.indexPrice === undefined ? null : Number(p.indexPrice));
  if (m) out.push(m);
  if (i) out.push(i);
  return out;
}

/** funding 记录（双所统一走 heartbeat 路径）：
 * - OKX：F-1（源 ts 为下一结算时刻，恒未来，event-age 路径不适用）。
 * - Binance：源 ts 为上一结算时刻（8h/4h 网格），若以 fundingTime 算 event-age
 *   则恒超 4×采集节拍而永久 unavailable——基线原文"结算跳变本身非 stale"，
 *   故同样只走 heartbeat 路径：本 sweep 成功即 ok；跨 sweep 缺席（无新记录 +
 *   异常事件）即按冻结 heartbeat（连续 120s 无响应）判 stale/unavailable。
 *   判定消费方以"记录缺席 + anomaly"识别 outage，禁把 fundingTime 当 event-age 代入。
 */
function buildFundingRecords(t: FwdTarget, ctx: SweepContext, parsed: ParsedTarget, fr: FetchResult): ResearchRecord[] {
  const { key } = regKey(t.exchange, t.coin);
  const rows = parsed.payload as Record<string, unknown>[];
  const last = rows[rows.length - 1];
  const fundingTime = num(last['fundingTime']);
  const rateRaw = last['realizedRate'] ?? last['fundingRate'];
  const rate = typeof rateRaw === 'string' || typeof rateRaw === 'number' ? Number(rateRaw) : NaN;
  const rateNorm = Number.isFinite(rate) ? rate : null;
  // 双所统一 heartbeat 路径（见函数头注释）：本 sweep 成功即 ok。
  const freshness: 'ok' | 'stale' | 'unavailable' = 'ok';
  const reason: string | null =
    t.exchange === 'okx'
      ? 'OKX funding 只走 heartbeat 路径（F-1：event age 恒为负，禁判）'
      : 'Binance funding 只走 heartbeat 路径（fundingTime 为结算网格时刻，event-age 代入恒误报；结算跳变本身非 stale）';
  const out: ResearchRecord[] = [];
  out.push(
    baseRecord(t, ctx, 'funding_current', rateNorm ?? String(rateRaw ?? 'null'), rateNorm, fundingTime, fr.receiveTimeMs, freshness, rateNorm === null ? 'funding_rate_missing' : null, buildDedupKey({ kind: 'funding', exchange: t.exchange, instrumentRegistryKey: key, nativeId: fundingTime ?? `no-ts:${ctx.snapshotId}` }), {
      source_diag: { url: fr.url, latencyMs: fr.latencyMs, fundingTime, datingNote: t.exchange === 'okx' ? '下一结算时刻（未来 dating，F-1）' : '上一结算时刻', freshnessReason: reason },
    }),
  );
  if (fundingTime !== null) {
    out.push(
      baseRecord(t, ctx, 'next_funding_time', fundingTime, fundingTime, fundingTime, fr.receiveTimeMs, freshness, null, `${t.exchange}|${key}|next_funding_time:${fundingTime}`, {
        source_diag: { url: fr.url, note: '只表结算边界，禁作恢复依据（R-1）' },
      }),
    );
  }
  return out;
}

/** depth 快照记录（D-1 UNMAPPED：数据照存，freshness 诚实记 unavailable，禁自定映射）。 */
function buildDepthRecords(t: FwdTarget, ctx: SweepContext, parsed: ParsedTarget, fr: FetchResult): ResearchRecord[] {
  const { key } = regKey(t.exchange, t.coin);
  const entry = lookupInstrument(t.exchange, 'perp', t.coin as SymbolNorm)!;
  let bids: [number, number][] = [];
  let asks: [number, number][] = [];
  let seq: number | null = null;
  let updateId: string | null = null;
  if (t.exchange === 'okx') {
    const p = parsed.payload as { bids?: unknown; asks?: unknown; seqId?: unknown };
    const toLv = (v: unknown): [number, number][] => (Array.isArray(v) ? (v as unknown[]).map((r) => [Number((r as unknown[])[0]), Number((r as unknown[])[1])] as [number, number]).filter(([a, b]) => Number.isFinite(a) && a > 0 && Number.isFinite(b) && b >= 0) : []);
    bids = toLv(p.bids);
    asks = toLv(p.asks).sort((a, b) => a[0] - b[0]);
    seq = typeof p.seqId === 'string' || typeof p.seqId === 'number' ? Number(p.seqId) : null;
    if (seq !== null && !Number.isFinite(seq)) seq = null;
    updateId = seq !== null ? String(p.seqId) : null;
  } else {
    const p = parsed.payload as { bids?: unknown; asks?: unknown; lastUpdateId?: unknown };
    const toLv = (v: unknown): [number, number][] => (Array.isArray(v) ? (v as unknown[]).map((r) => [Number((r as unknown[])[0]), Number((r as unknown[])[1])] as [number, number]).filter(([a, b]) => Number.isFinite(a) && a > 0 && Number.isFinite(b) && b >= 0) : []);
    bids = toLv(p.bids).sort((a, b) => b[0] - a[0]);
    asks = toLv(p.asks).sort((a, b) => a[0] - b[0]);
    seq = typeof p.lastUpdateId === 'number' ? p.lastUpdateId : null;
    updateId = seq !== null ? String(seq) : null;
  }
  const evt = parsed.eventTimeMs;
  const bestBidN = bids.length ? bids[0][0] : null;
  const bestAskN = asks.length ? asks[0][0] : null;
  const bestBidC = bestBidN === null ? null : canonicalizePrice(entry, bestBidN);
  const bestAskC = bestAskN === null ? null : canonicalizePrice(entry, bestAskN);
  const spreadBps = bestBidC !== null && bestAskC !== null && bestAskC !== 0 ? ((bestAskC - bestBidC) / Math.abs(bestAskC)) * 10_000 : null;
  const depthNotional = (levels: [number, number][], refC: number | null): number | null => {
    if (refC === null) return null;
    const lo = refC * 0.995;
    let acc = 0;
    for (const [pxN, qtyN] of levels) {
      const pxC = canonicalizePrice(entry, pxN);
      if (pxC === null || pxC < lo) continue;
      acc += qtyN * pxC;
    }
    return acc;
  };
  const note = 'D-1 UNMAPPED：§6-0 无 depth freshness 行，freshness 诚实记 unavailable（禁自定映射）；数据照存待协议修订';
  const mk = (field: string, valueRaw: number | string, valueNorm: number | null): ResearchRecord =>
    baseRecord(t, ctx, field, valueRaw, valueNorm, evt, fr.receiveTimeMs, 'unavailable', null, `${t.exchange}|${key}|${field}:${seq ?? evt ?? `no-seq:${ctx.snapshotId}`}`, {
      source_sequence: seq,
      source_event_id: updateId,
      source_diag: { url: fr.url, latencyMs: fr.latencyMs, sequence: seq, freshnessNote: note, qtyNote: 'depth 数量按原生单位×canonical 价估算名义值（OKX 张数未转 base，禁跨所比较）' },
    });
  return [
    mk('best_bid', bestBidN ?? 'null', bestBidC),
    mk('best_ask', bestAskN ?? 'null', bestAskC),
    mk('spread_bps', spreadBps ?? 'null', spreadBps),
    mk('depth_bid_0p5', 'snapshot', depthNotional(bids, bestBidC)),
    mk('depth_ask_0p5', 'snapshot', depthNotional(asks, bestAskC)),
  ];
}

/* ---------------- 单轮 sweep（顺序执行，禁并发自限流） ---------------- */

export interface SweepResult {
  snapshotId: string;
  sweepStartMs: number;
  records: ResearchRecord[];
  anomalies: ResearchRecord[];
  perChannel: Record<string, { ok: number; fail: number }>;
  validationErrors: string[];
}

/** 单轮全扫：按 target 顺序执行，先 mark/index（Binance OI 依赖 mark），再其余。
 * persistent.failStreaks 跨 sweep 复用（常驻 runner 传入；单轮调用缺省即建），
 * 使 trades heartbeat（连续失败≥2）与异常 streak 在常驻中连续计数。 */
export async function sweepOnce(
  fetchJson: FetchJson = defaultFetchJson,
  persistent?: { failStreaks?: Map<string, number> },
): Promise<SweepResult> {
  const sweepStartMs = Date.now();
  const context: SweepContext = {
    snapshotId: `fwd-${sweepStartMs}`,
    sweepStartMs,
    binanceMarkCanonical: new Map(),
    failStreaks: persistent?.failStreaks ?? new Map(),
  };
  const targets = buildForwardTargets();
  // Binance OI 依赖同 sweep mark：mark/index 先行。
  const ordered = [...targets].sort((a, b) => {
    const rank = (t: FwdTarget): number => (t.channel === 'mark' || t.channel === 'index' ? 0 : 1);
    return rank(a) - rank(b);
  });
  const records: ResearchRecord[] = [];
  const anomalies: ResearchRecord[] = [];
  const perChannel: SweepResult['perChannel'] = {};
  const bump = (t: FwdTarget, ok: boolean): void => {
    const k = `${t.exchange}|${t.channel}`;
    perChannel[k] ??= { ok: 0, fail: 0 };
    if (ok) perChannel[k].ok += 1;
    else perChannel[k].fail += 1;
  };
  for (const t of ordered) {
    if (t.exchange === 'binance' && t.channel === 'index') continue; // 复用 mark 响应，不另发请求
    const fr = await fetchTarget(t, fetchJson);
    if (!fr.ok) {
      bump(t, false);
      anomalies.push(buildAnomalyRecord(t, context, fr.errorKind, fr.errorDetail, fr.receiveTimeMs, fr.url));
      continue;
    }
    const parsed = parseResponse(t, fr.body);
    if (parsed.eventTimeMs === null || parsed.payload === null) {
      bump(t, false);
      anomalies.push(buildAnomalyRecord(t, context, 'bad_body', parsed.vendorNote ?? 'missing source ts', fr.receiveTimeMs, fr.url));
      continue;
    }
    resetStreak(context, t);
    bump(t, true);
    switch (t.channel) {
      case 'oi':
        records.push(...buildOiRecords(t, context, parsed, fr));
        break;
      case 'trades':
        records.push(...buildTradeRecords(t, context, parsed, fr));
        break;
      case 'mark':
        // Binance premiumIndex 单响应同时派生 mark + index（buildMarkRecords 内已处理，不另发请求）。
        records.push(...buildMarkRecords(t, context, parsed, fr));
        break;
      case 'index':
        records.push(...buildMarkRecords(t, context, parsed, fr, 'index_price'));
        break;
      case 'funding_current':
        records.push(...buildFundingRecords(t, context, parsed, fr));
        break;
      case 'depth':
        records.push(...buildDepthRecords(t, context, parsed, fr));
        break;
    }
  }
  const validationErrors: string[] = [];
  for (const r of [...records, ...anomalies]) {
    const errs = validateRecord(r);
    if (errs.length) validationErrors.push(`${r.dedup_key}: ${errs.join('; ')}`);
  }
  return { snapshotId: context.snapshotId, sweepStartMs, records, anomalies, perChannel, validationErrors };
}

/** 幂等写入 research store（WS/回补共用语义：dedup_key 重复禁入）。 */
export function sweepInto(
  store: ResearchStore | RawStore,
  dedup: DedupStore,
  batch: ResearchRecord[],
): { inserted: number; duplicates: number } {
  const { inserted } = ingestBatch(dedup, batch);
  const raw: RawStore = store instanceof ResearchStore ? store.raw : store;
  let n = 0;
  for (const r of inserted) {
    if (raw.append(r)) n += 1;
  }
  return { inserted: n, duplicates: batch.length - n };
}

/** 前向采集常驻单例（server-side research store 复用；实时链路禁 import 本模块）。 */
export const forwardStore = new ResearchStore();
export const forwardDedup = new DedupStore();
