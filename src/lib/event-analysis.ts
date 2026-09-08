/**
 * 历史事件复算（V2）。
 *
 * V1 用「事件开始前固定 7 日最高价 + 等待未来价格突破」这一人工口径复刻历史。
 * V2 改为与实时系统**完全同一套** Rolling Breakout detector（见 breakout.ts），
 * 并新增：MFE/MAE、从 breakoutTs 起算的 follow-through 量能、ratio-based 相对强弱。
 *
 * 时区整改（P0-1）：事件日期一律按「北京时间日历日」理解，显式转成 UTC ISO 参与计算。
 */
import { avg, maxDrawdown, meanTrueRangePct, median, pct, emaAt } from './indicators';
import { detectBreakoutAt } from './breakout';
import { calculateExcursion } from './mfe-mae';
import { syntheticRatio } from './relative-strength';
import { parseISO, CANDLE_4H_MS } from './time';
import type { Candle } from './types';

export interface EventDef {
  id: string;
  coin: 'PEPE' | 'DOGE';
  /** 展示用北京时间日历日（起始）。 */
  start: string;
  /** 展示用北京时间日历日（结束）。 */
  end: string;
  /** 参与计算的完整 UTC ISO 时间戳（= start 对应 CST 00:00 → 前一日 16:00Z）。 */
  startIso: string;
  endIso: string;
}

export interface EventMetrics {
  id: string;
  coin: 'PEPE' | 'DOGE';
  start: string;
  end: string;
  startTs: number;
  endTs: number;
  /* ---- Setup（相对事件窗口起点，仅突破前） ---- */
  preReturnPct: number;
  preRangePct: number;
  preAtrPct: number;
  compressionRatio: number;
  preVolumeRatio: number;
  startAboveEma20: boolean;
  emaBullishStack: boolean;
  preFundingAvgPct: number | null;
  preFundingMaxPct: number | null;
  /* ---- Breakout（V2 rolling detector） ---- */
  breakoutTs: number | null;
  breakoutLevel: number | null;
  breakoutClose: number | null;
  breakoutDistancePct: number | null;
  breakoutDelayHours: number | null;
  breakoutVolRatio: number | null;
  /* ---- Follow-through（从 breakoutTs 起算） ---- */
  followThrough24hVolRatio: number | null;
  followThrough48hVolRatio: number | null;
  /* ---- MFE / MAE（从 breakoutTs 起算） ---- */
  mfe24h: number | null;
  mae24h: number | null;
  mfe48h: number | null;
  mae48h: number | null;
  mfe72h: number | null;
  mae72h: number | null;
  mfe7d: number | null;
  mae7d: number | null;
  /* ---- 事后完整波段（Hindsight，明确标注，不与突破收益混用） ---- */
  eventLow: number;
  eventHigh: number;
  coinPeakReturn: number;
  eventMaxDrawdown: number;
  /* ---- BTC ---- */
  btcReturnPct: number;
  btcPeakReturnPct: number;
  btcMaxDrawdown: number;
  /* ---- 相对强弱（ratio-based，统一时间口径） ---- */
  relativeReturn24h: number | null;
  relativeReturn72h: number | null;
  relativeStrengthPercentile: number | null;
  /* ---- 资金费率 ---- */
  eventFundingAvgPct: number | null;
  eventFundingMaxPct: number | null;
  eventFundingOverheatRate: number | null;
  /* ---- 事后标签（由 samples.ts 扫描器填充） ---- */
  outcome: 'success' | 'failure' | 'normal' | null;
}

export const EVENT_DEFS: EventDef[] = [
  { id: 'P01', coin: 'PEPE', start: '2024-05-20', end: '2024-05-30', startIso: '2024-05-19T16:00:00Z', endIso: '2024-05-29T16:00:00Z' },
  { id: 'P02', coin: 'PEPE', start: '2024-11-05', end: '2024-11-17', startIso: '2024-11-04T16:00:00Z', endIso: '2024-11-16T16:00:00Z' },
  { id: 'P03', coin: 'PEPE', start: '2025-03-23', end: '2025-03-28', startIso: '2025-03-22T16:00:00Z', endIso: '2025-03-27T16:00:00Z' },
  { id: 'P04', coin: 'PEPE', start: '2025-05-06', end: '2025-05-15', startIso: '2025-05-05T16:00:00Z', endIso: '2025-05-14T16:00:00Z' },
  { id: 'P05', coin: 'PEPE', start: '2025-07-08', end: '2025-07-14', startIso: '2025-07-07T16:00:00Z', endIso: '2025-07-13T16:00:00Z' },
  { id: 'P06', coin: 'PEPE', start: '2025-08-06', end: '2025-08-11', startIso: '2025-08-05T16:00:00Z', endIso: '2025-08-10T16:00:00Z' },
  { id: 'P07', coin: 'PEPE', start: '2026-01-01', end: '2026-01-08', startIso: '2025-12-31T16:00:00Z', endIso: '2026-01-07T16:00:00Z' },
  { id: 'P08', coin: 'PEPE', start: '2026-02-10', end: '2026-02-17', startIso: '2026-02-09T16:00:00Z', endIso: '2026-02-16T16:00:00Z' },
  { id: 'P09', coin: 'PEPE', start: '2026-03-13', end: '2026-03-20', startIso: '2026-03-12T16:00:00Z', endIso: '2026-03-19T16:00:00Z' },
  { id: 'P10', coin: 'PEPE', start: '2026-06-28', end: '2026-07-08', startIso: '2026-06-27T16:00:00Z', endIso: '2026-07-07T16:00:00Z' },
  { id: 'P11', coin: 'PEPE', start: '2026-08-19', end: '2026-08-30', startIso: '2026-08-18T16:00:00Z', endIso: '2026-08-29T16:00:00Z' },
  { id: 'D01', coin: 'DOGE', start: '2024-11-04', end: '2024-11-25', startIso: '2024-11-03T16:00:00Z', endIso: '2024-11-24T16:00:00Z' },
  { id: 'D02', coin: 'DOGE', start: '2025-01-02', end: '2025-01-20', startIso: '2025-01-01T16:00:00Z', endIso: '2025-01-19T16:00:00Z' },
  { id: 'D03', coin: 'DOGE', start: '2025-02-28', end: '2025-03-05', startIso: '2025-02-27T16:00:00Z', endIso: '2025-03-04T16:00:00Z' },
  { id: 'D04', coin: 'DOGE', start: '2025-05-08', end: '2025-05-14', startIso: '2025-05-07T16:00:00Z', endIso: '2025-05-13T16:00:00Z' },
  { id: 'D05', coin: 'DOGE', start: '2025-07-16', end: '2025-07-24', startIso: '2025-07-15T16:00:00Z', endIso: '2025-07-23T16:00:00Z' },
  { id: 'D06', coin: 'DOGE', start: '2025-08-07', end: '2025-08-12', startIso: '2025-08-06T16:00:00Z', endIso: '2025-08-11T16:00:00Z' },
  { id: 'D07', coin: 'DOGE', start: '2025-09-04', end: '2025-09-17', startIso: '2025-09-03T16:00:00Z', endIso: '2025-09-16T16:00:00Z' },
  { id: 'D08', coin: 'DOGE', start: '2025-12-30', end: '2026-01-08', startIso: '2025-12-29T16:00:00Z', endIso: '2026-01-07T16:00:00Z' },
  { id: 'D09', coin: 'DOGE', start: '2026-02-12', end: '2026-02-17', startIso: '2026-02-11T16:00:00Z', endIso: '2026-02-16T16:00:00Z' },
  { id: 'D10', coin: 'DOGE', start: '2026-08-19', end: '2026-08-26', startIso: '2026-08-18T16:00:00Z', endIso: '2026-08-25T16:00:00Z' },
];

export interface FundingRow {
  ts: number;
  rate: number;
}

const DAY = 86_400_000;
const BREAKOUT_LOOKBACK = 42; // 7 天 × 6 根 4H

/** 在 [startTs, endTs] 内找第一个 rolling 突破；找不到则回退到 [startTs-2d, startTs) 找最近一个。 */
function findBreakout(
  coinBars: Candle[],
  startTs: number,
  endTs: number,
): { index: number; ts: number; level: number; close: number; distancePct: number; volumeRatio: number | null } | null {
  // 主窗口：从事件开始往后找第一个突破
  for (let i = 0; i < coinBars.length; i++) {
    const b = coinBars[i];
    if (b.ts < startTs) continue;
    if (b.ts > endTs) break;
    const sig = detectBreakoutAt(coinBars, i, { lookbackCandles: BREAKOUT_LOOKBACK });
    if (sig) return sig;
  }
  // 回退：事件开始前 2 日内最近一个突破
  const floor = startTs - 2 * DAY;
  for (let i = coinBars.length - 1; i >= 0; i--) {
    const b = coinBars[i];
    if (b.ts < floor) break;
    if (b.ts >= startTs) continue;
    const sig = detectBreakoutAt(coinBars, i, { lookbackCandles: BREAKOUT_LOOKBACK });
    if (sig) return sig;
  }
  return null;
}

/** ratio-based 相对收益：从 fromTs 那根起，往前 horizonCandles 根（4H）的比值涨跌幅 %。 */
function relativeReturnFrom(
  coinBars: Candle[],
  btcBars: Candle[],
  fromTs: number,
  horizonCandles: number,
): number | null {
  const ratio = syntheticRatio(coinBars, btcBars);
  const start = ratio.find((r) => r.ts >= fromTs);
  if (!start) return null;
  const endTs = fromTs + horizonCandles * CANDLE_4H_MS;
  const end = ratio.filter((r) => r.ts <= endTs).at(-1);
  if (!end || start.ratio <= 0) return null;
  return pct(end.ratio, start.ratio);
}

export function computeEventMetrics(
  event: EventDef,
  coinBars: Candle[],
  btcBars: Candle[],
  funding: FundingRow[],
): EventMetrics {
  const startTs = parseISO(event.startIso);
  const endTs = parseISO(event.endIso);

  const pre7 = coinBars.filter((b) => b.ts >= startTs - 7 * DAY && b.ts < startTs);
  const preEarly = coinBars.filter((b) => b.ts >= startTs - 10 * DAY && b.ts < startTs - 3 * DAY);
  const preLate = coinBars.filter((b) => b.ts >= startTs - 3 * DAY && b.ts < startTs);
  const eventBars = coinBars.filter((b) => b.ts >= startTs && b.ts < endTs);
  const btcEvent = btcBars.filter((b) => b.ts >= startTs && b.ts < endTs);
  const preFunding = funding.filter((r) => r.ts >= startTs - 7 * DAY && r.ts < startTs);
  const eventFunding = funding.filter((r) => r.ts >= startTs && r.ts < endTs);

  if (!pre7.length || !eventBars.length || !btcEvent.length) {
    throw new Error(`Missing bars for ${event.id}`);
  }

  const preHigh = Math.max(...pre7.map((b) => b.h));
  const preLow = Math.min(...pre7.map((b) => b.l));
  const preStart = pre7[0].o;
  const preEnd = pre7.at(-1)!.c;
  const eventLow = Math.min(...eventBars.map((b) => b.l));
  const eventHigh = Math.max(...eventBars.map((b) => b.h));
  const eventOpen = eventBars[0].o;

  const ema20 = emaAt(coinBars, 20, startTs);
  const ema50 = emaAt(coinBars, 50, startTs);
  const ema100 = emaAt(coinBars, 100, startTs);

  // ---- V2 rolling breakout ----
  const brk = findBreakout(coinBars, startTs, endTs);
  const breakoutTs = brk?.ts ?? null;
  const breakoutLevel = brk?.level ?? null;
  const breakoutClose = brk?.close ?? null;
  const breakoutDistancePct = brk?.distancePct ?? null;
  const breakoutVolRatio = brk?.volumeRatio ?? null;
  const breakoutDelayHours = breakoutTs != null ? (breakoutTs - startTs) / 3_600_000 : null;

  // ---- Follow-through（从 breakoutTs 起算） ----
  let followThrough24hVolRatio: number | null = null;
  let followThrough48hVolRatio: number | null = null;
  if (brk) {
    const baseline = coinBars.slice(Math.max(0, brk.index - BREAKOUT_LOOKBACK), brk.index).map((b) => b.quoteVol);
    const baselineMed = median(baseline);
    const post = coinBars.filter((b) => b.ts > brk.ts);
    const in24 = post.filter((b) => b.ts <= brk.ts + 24 * 3_600_000);
    const in48 = post.filter((b) => b.ts <= brk.ts + 48 * 3_600_000);
    followThrough24hVolRatio =
      baselineMed != null && baselineMed > 0 && in24.length >= 6 ? avg(in24.map((b) => b.quoteVol))! / baselineMed : null;
    followThrough48hVolRatio =
      baselineMed != null && baselineMed > 0 && in48.length >= 12 ? avg(in48.map((b) => b.quoteVol))! / baselineMed : null;
  }

  // ---- MFE / MAE ----
  const refPrice = breakoutClose ?? eventOpen;
  const mfe24h = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 24, refPrice).mfe : null;
  const mae24h = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 24, refPrice).mae : null;
  const mfe48h = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 48, refPrice).mfe : null;
  const mae48h = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 48, refPrice).mae : null;
  const mfe72h = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 72, refPrice).mfe : null;
  const mae72h = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 72, refPrice).mae : null;
  const mfe7d = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 168, refPrice).mfe : null;
  const mae7d = breakoutTs != null ? calculateExcursion(coinBars, breakoutTs, 168, refPrice).mae : null;

  // ---- Hindsight 波段（明确标注，不与突破收益混用） ----
  const coinPeakReturn = pct(eventHigh, eventLow);

  const btcStart = btcEvent[0].o;
  const btcEnd = btcEvent.at(-1)!.c;
  const btcHigh = Math.max(...btcEvent.map((b) => b.h));
  const btcPeakReturn = pct(btcHigh, btcStart);

  // ---- ratio-based 相对强弱 ----
  const relativeReturn24h = breakoutTs != null ? relativeReturnFrom(coinBars, btcBars, breakoutTs, 6) : null;
  const relativeReturn72h = breakoutTs != null ? relativeReturnFrom(coinBars, btcBars, breakoutTs, 18) : null;
  const relativeStrengthPercentile = null; // 由 samples.ts 用完整历史窗口计算

  const compressionRatio = meanTrueRangePct(preLate)! / meanTrueRangePct(preEarly)!;
  const preVolumeRatio = avg(preLate.map((b) => b.quoteVol))! / avg(preEarly.map((b) => b.quoteVol))!;

  return {
    id: event.id,
    coin: event.coin,
    start: event.start,
    end: event.end,
    startTs,
    endTs,
    preReturnPct: pct(preEnd, preStart),
    preRangePct: pct(preHigh, preLow),
    preAtrPct: meanTrueRangePct(pre7)!,
    compressionRatio,
    preVolumeRatio,
    startAboveEma20: eventOpen > (ema20 ?? Infinity),
    emaBullishStack: (ema20 ?? 0) > (ema50 ?? 0) && (ema50 ?? 0) > (ema100 ?? 0),
    preFundingAvgPct: preFunding.length ? avg(preFunding.map((r) => r.rate))! * 100 : null,
    preFundingMaxPct: preFunding.length ? Math.max(...preFunding.map((r) => r.rate)) * 100 : null,
    breakoutTs,
    breakoutLevel,
    breakoutClose,
    breakoutDistancePct,
    breakoutDelayHours,
    breakoutVolRatio,
    followThrough24hVolRatio,
    followThrough48hVolRatio,
    mfe24h,
    mae24h,
    mfe48h,
    mae48h,
    mfe72h,
    mae72h,
    mfe7d,
    mae7d,
    eventLow,
    eventHigh,
    coinPeakReturn,
    eventMaxDrawdown: maxDrawdown(eventBars),
    btcReturnPct: pct(btcEnd, btcStart),
    btcPeakReturnPct: btcPeakReturn,
    btcMaxDrawdown: maxDrawdown(btcEvent),
    relativeReturn24h,
    relativeReturn72h,
    relativeStrengthPercentile,
    eventFundingAvgPct: eventFunding.length ? avg(eventFunding.map((r) => r.rate))! * 100 : null,
    eventFundingMaxPct: eventFunding.length ? Math.max(...eventFunding.map((r) => r.rate)) * 100 : null,
    eventFundingOverheatRate: eventFunding.length
      ? eventFunding.filter((r) => r.rate >= 0.0003).length / eventFunding.length
      : null,
    outcome: null,
  };
}

/** 行情周期（campaign）：把时间接近、同属一轮市场行情的多个波段归到同一周期。 */
export interface Campaign {
  campaignId: string;
  label: string;
  /** 该周期包含的事件 id（PEPE + DOGE 同轮绑定同一 campaign）。 */
  eventIds: string[];
  /** 周期大致起止（UTC ISO，用于 walk-forward 排序）。 */
  startIso: string;
  endIso: string;
}

export const CAMPAIGNS: Campaign[] = [
  { campaignId: 'C01', label: '2024-11 大选行情', eventIds: ['P02', 'D01'], startIso: '2024-11-04T16:00:00Z', endIso: '2024-11-24T16:00:00Z' },
  { campaignId: 'C02', label: '2025-05 板块共振', eventIds: ['P04', 'D04'], startIso: '2025-05-05T16:00:00Z', endIso: '2025-05-14T16:00:00Z' },
  { campaignId: 'C03', label: '2025-07 风险偏好窗口', eventIds: ['P05', 'D05'], startIso: '2025-07-07T16:00:00Z', endIso: '2025-07-23T16:00:00Z' },
  { campaignId: 'C04', label: '2025-08 BTC 历史新高', eventIds: ['P06', 'D06'], startIso: '2025-08-05T16:00:00Z', endIso: '2025-08-11T16:00:00Z' },
  { campaignId: 'C05', label: '2025-12 / 2026-01 Meme 反击', eventIds: ['P07', 'D08'], startIso: '2025-12-29T16:00:00Z', endIso: '2026-01-07T16:00:00Z' },
  { campaignId: 'C06', label: '2026-02 空头回补', eventIds: ['P08', 'D09'], startIso: '2026-02-09T16:00:00Z', endIso: '2026-02-16T16:00:00Z' },
  { campaignId: 'C07', label: '2026-08 政策行情', eventIds: ['P11', 'D10'], startIso: '2026-08-18T16:00:00Z', endIso: '2026-08-29T16:00:00Z' },
];

/** 把事件映射到 campaign id（未归属的返回 null）。 */
export function assignCampaign(eventId: string): string | null {
  for (const c of CAMPAIGNS) {
    if (c.eventIds.includes(eventId)) return c.campaignId;
  }
  return null;
}
