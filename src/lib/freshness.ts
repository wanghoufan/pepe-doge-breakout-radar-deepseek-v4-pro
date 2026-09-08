/**
 * 数据新鲜度（P0 可靠性整改，纯函数，无网络、无 UI）。
 *
 * 定位：把「数据有多旧」统一成三态，供 overview / Action / 来源新鲜度行共用。
 * - 三态：'ok' | 'stale' | 'unavailable'（与 ActionInput.dataStatus 同口径）。
 * - 这是可靠性 SLA（数据链路是否新鲜），不是交易阈值/权重/M5，不参与任何评分与回测。
 * - 判定只依赖时间戳，不读交易所、不碰密钥、不做声音报警。
 *
 * Phase A 统一语义（全仓唯一口径，见 time.ts）：
 * - candleOpenTs 是区间起点，K 线覆盖 [candleOpenTs, candleOpenTs + 4H)；
 *   confirmed candle 的 candleCloseTs = openTs + 4H。
 * - 禁止把 openTs 直接解读为「最后更新时间」：所有「X 前收盘」展示必须用
 *   now - candleCloseTs（helper 见 describeCandleFreshness），否则会虚增 4h。
 * - K 线新鲜度走「期望收盘 Bar 对比」口径（assessCandleFreshness），不再用
 *   8h 年龄口径判 K 线；8h 年龄口径（assessFeedFreshness）仅保留给现价 ticker
 *   等非 K 线链路。
 */

import { CANDLE_4H_MS, candleCloseTs, expectedLastConfirmedOpenTs, floorTo4H } from './time';

export type FeedStatus = 'ok' | 'stale' | 'unavailable';

export interface FeedFreshness {
  status: FeedStatus;
  lastUpdatedTs: number | null;
  reason: string | null;
}

/**
 * K 线/现价链路判 stale 的最大允许年龄。
 * 4H 口径下漏掉连续 2 根已收盘 K 线（8h）即判 stale，要求人工关注而不是继续当 fresh 用。
 * 仅用于现价 ticker 等非 K 线链路的新鲜度展示与 DATA_BLOCKED 门控，不进入任何量化评分。
 * 注意：K 线链路 Phase A 起改走期望收盘 Bar 对比口径（assessCandleFreshness），
 * 不再用本阈值判 K 线；本阈值保留给现价链路。
 */
export const CANDLE_STALE_AFTER_MS = 8 * 3_600_000;

/** 资金费率链路判 stale 的最大允许年龄（相对 K 线末根，24h ≈ 漏 3 期）。 */
export const FUNDING_STALE_AFTER_MS = 24 * 3_600_000;

function isValidTs(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/* ------------------------------------------------------------------ */
/* Phase A：4H K 线期望收盘 Bar 对比口径（K 线链路唯一口径）            */
/* ------------------------------------------------------------------ */

/**
 * K 线新鲜度三态（Phase A 对外口径，大写，与 FeedStatus 对应：
 * LIVE↔ok，STALE↔stale，UNAVAILABLE↔unavailable）。
 */
export type CandleFreshnessStatus = 'LIVE' | 'STALE' | 'UNAVAILABLE';

/** Phase A staleReason 编码（API 对外唯一口径）：LIVE→null，其余见下。 */
export type CandleStaleReason =
  | 'latest_confirmed_candle_behind_expected_bar'
  | 'confirmed_candle_missing';

/**
 * K 线收盘宽限期（集中配置，全仓唯一来源，禁止散落硬编码）。
 * - Old：无宽限（期望 Bar 一收盘即判 STALE，收盘后最初几分钟必误判）。
 * - New：15 分钟。
 * - Reason：OKX confirm 位翻转 + 服务端 60s 缓存 + 前端轮询间隔，收盘后数据
 *   到达天然有分钟级延迟；宽限只覆盖「刚收盘、数据在路上」，过期 Bar 照判 STALE。
 * - 是否改输出：会。收盘后宽限期内的缺 Bar 由 STALE→LIVE；宽限期外与过期行为不变。
 * - 非交易阈值/权重，不参与任何评分与回测，仅新鲜度展示与 DATA_BLOCKED 门控。
 */
export const CANDLE_FRESHNESS_GRACE_MS = 15 * 60_000;

export interface CandleFreshness {
  status: CandleFreshnessStatus;
  /** 实际最近已收盘 K 线 openTs（= open 语义，禁止直解为更新时间）。 */
  actualLastConfirmedOpenTs: number | null;
  /** 实际最近已收盘 K 线 closeTs（= openTs + 4H，展示用它算「X 前收盘」）。 */
  actualLastConfirmedCloseTs: number | null;
  /** 期望最近已收盘 K 线 openTs（= floorTo4H(now) - 4H）。 */
  expectedLastConfirmedOpenTs: number;
  /** 期望最近已收盘 K 线 closeTs（= expected + 4H = floorTo4H(now)）。 */
  expectedLastConfirmedCloseTs: number;
  /** 当前形成中 4H 的 openTs（未收盘，只展示，不确认突破）。 */
  current4HOpenTs: number;
  /** 落后 Bar 数（LIVE 对齐时为 0，缺失时为 null）。 */
  candleLagBars: number | null;
  /** 编码：LIVE→null；STALE→behind_expected_bar；UNAVAILABLE→missing。 */
  staleReason: CandleStaleReason | null;
  /** 人读明细（UI 展示用，机器判定只看 status/staleReason）。 */
  detail: string | null;
}

/**
 * 单币种 K 线新鲜度（Phase A 核心判定，纯函数）。
 * - actual 缺失/非法/请求失败（调用方传 null）→ UNAVAILABLE（confirmed_candle_missing）。
 * - actual == expected（或更新，时钟漂移容忍）→ LIVE。
 * - actual < expected：落后 lagBars = ceil((expected - actual) / 4H)；
 *   仅当只缺刚收盘那一根（lagBars == 1）且仍在收盘宽限期内
 *   （now - expectedClose <= grace）→ LIVE（边界不误判）；
 *   否则 → STALE（latest_confirmed_candle_behind_expected_bar）。
 * - STALE/UNAVAILABLE 调用方必须走 DATA_BLOCKED，禁止沿用
 *   BREAKOUT_TRACK / RETEST_WATCH / WATCH（由 action.ts dataStatus 门控执行）。
 */
export function assessCandleFreshness(
  actualLastConfirmedOpenTs: number | null,
  now: number = Date.now(),
  graceMs: number = CANDLE_FRESHNESS_GRACE_MS,
): CandleFreshness {
  const current = floorTo4H(now);
  const expected = expectedLastConfirmedOpenTs(now);
  const expectedClose = expected + CANDLE_4H_MS;
  const base = {
    expectedLastConfirmedOpenTs: expected,
    expectedLastConfirmedCloseTs: expectedClose,
    current4HOpenTs: current,
  };
  if (!isValidTs(actualLastConfirmedOpenTs)) {
    return {
      status: 'UNAVAILABLE',
      actualLastConfirmedOpenTs: null,
      actualLastConfirmedCloseTs: null,
      ...base,
      candleLagBars: null,
      staleReason: 'confirmed_candle_missing',
      detail: '最近已收盘 K 线缺失或非法，无法判定新鲜度',
    };
  }
  const actual = actualLastConfirmedOpenTs as number;
  if (actual >= expected) {
    return {
      status: 'LIVE',
      actualLastConfirmedOpenTs: actual,
      actualLastConfirmedCloseTs: candleCloseTs(actual),
      ...base,
      candleLagBars: 0,
      staleReason: null,
      detail: null,
    };
  }
  const lagBars = Math.max(1, Math.ceil((expected - actual) / CANDLE_4H_MS));
  // 宽限只覆盖「仅缺刚收盘那一根」（lagBars == 1）：收盘后数据在路上；
  // 落后 ≥2 根说明连上一根（4h 前已收盘）都没到，宽限期外照判 STALE。
  if (lagBars <= 1 && now - expectedClose <= graceMs) {
    return {
      status: 'LIVE',
      actualLastConfirmedOpenTs: actual,
      actualLastConfirmedCloseTs: candleCloseTs(actual),
      ...base,
      candleLagBars: lagBars,
      staleReason: null,
      detail: `收盘宽限期内（落后 ${lagBars} 根 Bar，宽限 ${Math.round(graceMs / 60_000)} 分钟）`,
    };
  }
  return {
    status: 'STALE',
    actualLastConfirmedOpenTs: actual,
    actualLastConfirmedCloseTs: candleCloseTs(actual),
    ...base,
    candleLagBars: lagBars,
    staleReason: 'latest_confirmed_candle_behind_expected_bar',
    detail: `最近已收盘 K 线落后期望 Bar ${lagBars} 根`,
  };
}

/** CandleFreshnessStatus → FeedStatus（供 Action DATA_BLOCKED 门控复用）。 */
export function candleStatusToFeed(s: CandleFreshnessStatus): FeedStatus {
  return s === 'LIVE' ? 'ok' : s === 'STALE' ? 'stale' : 'unavailable';
}

export interface CandleOverviewFreshness {
  status: CandleFreshnessStatus;
  staleReason: CandleStaleReason | null;
  current4HOpenTs: number;
  expectedLastConfirmedOpenTs: number;
  expectedLastConfirmedCloseTs: number;
  perCoin: Record<'PEPE' | 'DOGE' | 'BTC', CandleFreshness>;
  /** 最差 lag（缺失币种不计入；全部缺失则为 null）。 */
  maxLagBars: number | null;
}

/**
 * 三币种 K 线新鲜度合并（三币同语义，共用同一 now/expected/grace）。
 * 合并规则：任一 UNAVAILABLE → UNAVAILABLE；否则任一 STALE → STALE；否则 LIVE。
 */
export function deriveCandleOverviewFreshness(
  lastConfirmedOpenTs: { PEPE: number | null; DOGE: number | null; BTC: number | null },
  now: number = Date.now(),
  graceMs: number = CANDLE_FRESHNESS_GRACE_MS,
): CandleOverviewFreshness {
  const perCoin = {
    PEPE: assessCandleFreshness(lastConfirmedOpenTs.PEPE, now, graceMs),
    DOGE: assessCandleFreshness(lastConfirmedOpenTs.DOGE, now, graceMs),
    BTC: assessCandleFreshness(lastConfirmedOpenTs.BTC, now, graceMs),
  };
  const list = [perCoin.PEPE, perCoin.DOGE, perCoin.BTC];
  const status: CandleFreshnessStatus = list.some((c) => c.status === 'UNAVAILABLE')
    ? 'UNAVAILABLE'
    : list.some((c) => c.status === 'STALE')
      ? 'STALE'
      : 'LIVE';
  const staleReason: CandleStaleReason | null =
    status === 'LIVE'
      ? null
      : status === 'STALE'
        ? 'latest_confirmed_candle_behind_expected_bar'
        : 'confirmed_candle_missing';
  const lags = list.map((c) => c.candleLagBars).filter((v): v is number => v != null);
  return {
    status,
    staleReason,
    current4HOpenTs: perCoin.PEPE.current4HOpenTs,
    expectedLastConfirmedOpenTs: perCoin.PEPE.expectedLastConfirmedOpenTs,
    expectedLastConfirmedCloseTs: perCoin.PEPE.expectedLastConfirmedCloseTs,
    perCoin,
    maxLagBars: lags.length ? Math.max(...lags) : null,
  };
}

/* ---------------- Phase A：全站统一文案（唯一口径） ---------------- */

/** 中文时长（展示「最近收盘 X」用，输入为毫秒）。 */
export function formatAgeCn(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h < 24) return rest === 0 ? `${h}小时前` : `${h}小时${rest}分钟前`;
  const d = Math.floor(h / 24);
  return `${d}天前`;
}

/**
 * K 线主口径文案（全站一种）：`K线PEPE·LIVE·最近收盘2小时20分钟前`。
 * 禁止用 openTs 直算：年龄 = now - closeTs（= openTs + 4H）。
 */
export function candleMainCopy(
  coin: 'PEPE' | 'DOGE' | 'BTC',
  actualLastConfirmedOpenTs: number | null,
  now: number,
  status: CandleFreshnessStatus,
): string {
  if (!isValidTs(actualLastConfirmedOpenTs)) return `K线${coin}·${status}·最近收盘未知`;
  const closeTs = candleCloseTs(actualLastConfirmedOpenTs as number);
  return `K线${coin}·${status}·最近收盘${formatAgeCn(now - closeTs)}`;
}

/**
 * 现价行文案（与 K 线分离）：`现价PEPE·LIVE·刚刚`。
 * 注意与 K 线行解耦：现价新鲜度走 ticker 时间戳，不吃 K 线收盘口径。
 */
export function priceMainCopy(
  coin: 'PEPE' | 'DOGE' | 'BTC',
  priceTs: number | null,
  now: number,
  status: FeedStatus,
): string {
  if (!isValidTs(priceTs)) return `现价${coin}·${status}·无更新`;
  return `现价${coin}·${status}·${formatAgeCn(now - (priceTs as number))}`;
}

/* ------------------------------------------------------------------ */

/**
 * 单路新鲜度：null/非法 → unavailable；年龄超限 → stale；否则 ok。
 * 允许 5 分钟未来时钟漂移（仍判 ok）。
 */
export function assessFeedFreshness(
  lastUpdatedTs: number | null,
  now: number = Date.now(),
  staleAfterMs: number = CANDLE_STALE_AFTER_MS,
): FeedFreshness {
  if (!isValidTs(lastUpdatedTs)) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '无最后有效更新时间' };
  }
  const age = now - (lastUpdatedTs as number);
  if (age < -5 * 60_000) {
    return { status: 'ok', lastUpdatedTs, reason: null };
  }
  if (age > staleAfterMs) {
    const h = Math.floor(age / 3_600_000);
    return {
      status: 'stale',
      lastUpdatedTs,
      reason: `数据已过期约 ${h}h（超 ${Math.floor(staleAfterMs / 3_600_000)}h 未更新）`,
    };
  }
  return { status: 'ok', lastUpdatedTs, reason: null };
}

/**
 * overview 级三态（P0-1 + Phase A）：feed 级缺失走 unavailable，不沿用旧信号。
 * - okxOk=false 或 canAnalyze=false → unavailable（与 MarketOverview.status 口径一致）。
 * - Phase A：K 线链路走期望收盘 Bar 对比（deriveCandleOverviewFreshness）；
 *   任一币种 UNAVAILABLE → unavailable，任一 STALE → stale。
 * - 现价链路仍走 8h 年龄口径（assessFeedFreshness）：缺失 → unavailable，过期 → stale。
 * - 合并取最差：unavailable > stale > ok。
 * - 否则 ok。
 * 必需时间戳 = 各币种最后已收盘 K 线 openTs + 各币种现价 ts
 * （funding 不阻塞 overview，见 P0-2）。
 */
export function deriveOverviewFreshness(input: {
  okxOk: boolean;
  canAnalyze: boolean;
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
  priceTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
  now?: number;
}): FeedFreshness {
  const now = input.now ?? Date.now();
  if (!input.okxOk || !input.canAnalyze) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '实时链路非 live，信号可能不是最新' };
  }
  // Phase A：K 线链路（期望收盘 Bar 对比，三币同语义）。
  const candle = deriveCandleOverviewFreshness(input.lastConfirmedTs, now);
  if (candle.status === 'UNAVAILABLE') {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '部分币种已收盘 K 线缺失，无法判定新鲜度' };
  }
  // 现价链路（8h 年龄口径，与 K 线分离判定）。
  const priceList = [input.priceTs.PEPE, input.priceTs.DOGE, input.priceTs.BTC];
  if (priceList.some((v) => !isValidTs(v))) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '部分必需时间戳缺失，无法判定新鲜度' };
  }
  const prices = priceList as number[];
  const oldestPrice = Math.min(...prices);
  const priceAssessed = assessFeedFreshness(oldestPrice, now, CANDLE_STALE_AFTER_MS);
  const candleFeed = candleStatusToFeed(candle.status);
  if (candleFeed === 'stale' || priceAssessed.status === 'stale') {
    // lastUpdatedTs 统一 close 口径（= openTs + 4H，与 candleMainCopy 一致）：
    // openTs 是区间起点，直用会把年龄虚增 4h，此处禁止直用 openTs。
    const oldestCandleOpen = Math.min(
      ...[input.lastConfirmedTs.PEPE, input.lastConfirmedTs.DOGE, input.lastConfirmedTs.BTC].filter(isValidTs),
    );
    const oldestCandle = candleCloseTs(oldestCandleOpen);
    const oldest = Math.min(oldestCandle, oldestPrice);
    if (candleFeed === 'stale') {
      return {
        status: 'stale',
        lastUpdatedTs: oldest,
        reason: `最近已收盘 K 线落后期望 Bar ${candle.maxLagBars ?? '?'} 根（疑似停更）`,
      };
    }
    return {
      status: 'stale',
      lastUpdatedTs: oldest,
      reason: `最后有效更新距今超 ${Math.floor(CANDLE_STALE_AFTER_MS / 3_600_000)}h（疑似停更）`,
    };
  }
  // ok 分支同上：lastUpdatedTs 取 close 口径（禁止直用 openTs，见上）。
  const oldestCandleOk = candleCloseTs(
    Math.min(
      ...[input.lastConfirmedTs.PEPE, input.lastConfirmedTs.DOGE, input.lastConfirmedTs.BTC].filter(isValidTs),
    ),
  );
  return { status: 'ok', lastUpdatedTs: Math.min(oldestCandleOk, oldestPrice), reason: null };
}

/**
 * 资金费率新鲜度（相对 K 线末根，不依赖墙钟，便于引擎内纯判定）。
 * funding 为空 → unavailable；末点相对 bars 末根过旧 → stale；否则 ok。
 */
export function assessFundingFreshness(
  funding: { ts: number }[],
  barsLastTs: number | null,
): FeedFreshness {
  if (!funding.length || !isValidTs(barsLastTs)) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '资金费率缺失' };
  }
  const last = funding[funding.length - 1].ts;
  if (!isValidTs(last)) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '资金费率时间戳非法' };
  }
  const age = (barsLastTs as number) - last;
  if (age > FUNDING_STALE_AFTER_MS) {
    return { status: 'stale', lastUpdatedTs: last, reason: '资金费率相对 K 线停更超 24h' };
  }
  return { status: 'ok', lastUpdatedTs: last, reason: null };
}
