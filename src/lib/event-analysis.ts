/**
 * 历史事件复算逻辑。与资料包 `04_分析脚本/analyze_breakouts.mjs` 口径一致，
 * 用于：回归测试（保证关键历史数值不被实现错误改变）、历史详情页的图表标注。
 */
import { avg, median, maxDrawdown, pct, emaAt, meanTrueRangePct } from './indicators';
import type { Candle } from './types';

export interface EventDef {
  id: string;
  coin: 'PEPE' | 'DOGE';
  start: string;
  end: string;
}

export interface EventMetrics {
  id: string;
  coin: 'PEPE' | 'DOGE';
  start: string;
  end: string;
  startTs: number;
  endTs: number;
  preReturnPct: number;
  preRangePct: number;
  preAtrPct: number;
  compressionRatio: number;
  preVolumeRatio: number;
  startAboveEma20: boolean;
  emaBullishStack: boolean;
  breakoutTs: number | null;
  breakoutDelayHours: number | null;
  breakoutVolRatio: number | null;
  first48AvgVolRatio: number;
  eventLow: number;
  eventHigh: number;
  coinPeakReturn: number;
  eventMaxDrawdown: number;
  btcReturnPct: number;
  btcPeakReturnPct: number;
  btcMaxDrawdown: number;
  relativePeakVsBtc: number;
  preFundingAvgPct: number | null;
  preFundingMaxPct: number | null;
  eventFundingAvgPct: number | null;
  eventFundingMaxPct: number | null;
  eventFundingOverheatRate: number | null;
}

export const EVENT_DEFS: EventDef[] = [
  { id: 'P01', coin: 'PEPE', start: '2024-05-20', end: '2024-05-30' },
  { id: 'P02', coin: 'PEPE', start: '2024-11-05', end: '2024-11-17' },
  { id: 'P03', coin: 'PEPE', start: '2025-03-23', end: '2025-03-28' },
  { id: 'P04', coin: 'PEPE', start: '2025-05-06', end: '2025-05-15' },
  { id: 'P05', coin: 'PEPE', start: '2025-07-08', end: '2025-07-14' },
  { id: 'P06', coin: 'PEPE', start: '2025-08-06', end: '2025-08-11' },
  { id: 'P07', coin: 'PEPE', start: '2026-01-01', end: '2026-01-08' },
  { id: 'P08', coin: 'PEPE', start: '2026-02-10', end: '2026-02-17' },
  { id: 'P09', coin: 'PEPE', start: '2026-03-13', end: '2026-03-20' },
  { id: 'P10', coin: 'PEPE', start: '2026-06-28', end: '2026-07-08' },
  { id: 'P11', coin: 'PEPE', start: '2026-08-19', end: '2026-08-30' },
  { id: 'D01', coin: 'DOGE', start: '2024-11-04', end: '2024-11-25' },
  { id: 'D02', coin: 'DOGE', start: '2025-01-02', end: '2025-01-20' },
  { id: 'D03', coin: 'DOGE', start: '2025-02-28', end: '2025-03-05' },
  { id: 'D04', coin: 'DOGE', start: '2025-05-08', end: '2025-05-14' },
  { id: 'D05', coin: 'DOGE', start: '2025-07-16', end: '2025-07-24' },
  { id: 'D06', coin: 'DOGE', start: '2025-08-07', end: '2025-08-12' },
  { id: 'D07', coin: 'DOGE', start: '2025-09-04', end: '2025-09-17' },
  { id: 'D08', coin: 'DOGE', start: '2025-12-30', end: '2026-01-08' },
  { id: 'D09', coin: 'DOGE', start: '2026-02-12', end: '2026-02-17' },
  { id: 'D10', coin: 'DOGE', start: '2026-08-19', end: '2026-08-26' },
];

export interface FundingRow {
  ts: number;
  rate: number;
}

const DAY = 86_400_000;

export function computeEventMetrics(
  event: EventDef,
  coinBars: Candle[],
  btcBars: Candle[],
  funding: FundingRow[],
): EventMetrics {
  const startTs = Date.parse(`${event.start}T00:00:00Z`);
  const endTs = Date.parse(`${event.end}T00:00:00Z`);

  const pre10 = coinBars.filter((b) => b.ts >= startTs - 10 * DAY && b.ts < startTs);
  const pre7 = coinBars.filter((b) => b.ts >= startTs - 7 * DAY && b.ts < startTs);
  const preEarly = coinBars.filter((b) => b.ts >= startTs - 10 * DAY && b.ts < startTs - 3 * DAY);
  const preLate = coinBars.filter((b) => b.ts >= startTs - 3 * DAY && b.ts < startTs);
  const eventBars = coinBars.filter((b) => b.ts >= startTs && b.ts < endTs);
  const first48h = coinBars.filter((b) => b.ts >= startTs && b.ts < startTs + 2 * DAY);
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
  const breakout = eventBars.find((b) => b.c > preHigh);
  const preMedianVol = median(pre7.map((b) => b.quoteVol));
  const breakoutVolRatio = breakout && preMedianVol ? breakout.quoteVol / preMedianVol : null;
  const first48AvgVolRatio = preMedianVol
    ? avg(first48h.map((b) => b.quoteVol))! / preMedianVol
    : NaN;

  const ema20 = emaAt(coinBars, 20, startTs);
  const ema50 = emaAt(coinBars, 50, startTs);
  const ema100 = emaAt(coinBars, 100, startTs);

  const btcStart = btcEvent[0].o;
  const btcEnd = btcEvent.at(-1)!.c;
  const btcHigh = Math.max(...btcEvent.map((b) => b.h));
  const coinPeakReturn = pct(eventHigh, eventLow);
  const btcPeakReturn = pct(btcHigh, btcStart);

  const compressionRatio = meanTrueRangePct(preLate)! / meanTrueRangePct(preEarly)!;
  const preVolumeRatio = avg(preLate.map((b) => b.quoteVol))! / avg(preEarly.map((b) => b.quoteVol))!;

  return {
    ...event,
    startTs,
    endTs,
    preReturnPct: pct(preEnd, preStart),
    preRangePct: pct(preHigh, preLow),
    preAtrPct: meanTrueRangePct(pre7)!,
    compressionRatio,
    preVolumeRatio,
    startAboveEma20: eventOpen > (ema20 ?? Infinity),
    emaBullishStack: (ema20 ?? 0) > (ema50 ?? 0) && (ema50 ?? 0) > (ema100 ?? 0),
    breakoutTs: breakout?.ts ?? null,
    breakoutDelayHours: breakout ? (breakout.ts - startTs) / 3_600_000 : null,
    breakoutVolRatio,
    first48AvgVolRatio: Number.isFinite(first48AvgVolRatio) ? first48AvgVolRatio : NaN,
    eventLow,
    eventHigh,
    coinPeakReturn,
    eventMaxDrawdown: maxDrawdown(eventBars),
    btcReturnPct: pct(btcEnd, btcStart),
    btcPeakReturnPct: btcPeakReturn,
    btcMaxDrawdown: maxDrawdown(btcEvent),
    relativePeakVsBtc: coinPeakReturn - btcPeakReturn,
    preFundingAvgPct: preFunding.length ? avg(preFunding.map((r) => r.rate))! * 100 : null,
    preFundingMaxPct: preFunding.length ? Math.max(...preFunding.map((r) => r.rate)) * 100 : null,
    eventFundingAvgPct: eventFunding.length ? avg(eventFunding.map((r) => r.rate))! * 100 : null,
    eventFundingMaxPct: eventFunding.length ? Math.max(...eventFunding.map((r) => r.rate)) * 100 : null,
    eventFundingOverheatRate: eventFunding.length
      ? eventFunding.filter((r) => r.rate >= 0.0003).length / eventFunding.length
      : null,
  };
}

/** 行情周期（campaign）：把时间接近、同属一轮市场行情的多个波段归到同一周期。 */
export interface Campaign {
  campaignId: string;
  label: string;
  /** 该周期包含的事件 id */
  eventIds: string[];
}

export const CAMPAIGNS: Campaign[] = [
  { campaignId: 'C01', label: '2024-11 大选行情', eventIds: ['P02', 'D01'] },
  { campaignId: 'C02', label: '2025-05 板块共振', eventIds: ['P04', 'D04'] },
  { campaignId: 'C03', label: '2025-07 风险偏好窗口', eventIds: ['P05', 'D05'] },
  { campaignId: 'C04', label: '2025-08 BTC 历史新高', eventIds: ['P06', 'D06'] },
  { campaignId: 'C05', label: '2025-12 / 2026-01 Meme 反击', eventIds: ['P07', 'D08'] },
  { campaignId: 'C06', label: '2026-02 空头回补', eventIds: ['P08', 'D09'] },
  { campaignId: 'C07', label: '2026-08 政策行情', eventIds: ['P11', 'D10'] },
];