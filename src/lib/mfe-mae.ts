/**
 * MFE / MAE 计算（P0-4，V2 核心纯函数）。
 *
 * 定义：
 * - MFE（Maximum Favorable Excursion）：突破后某时间窗内，最高价相对
 *   breakoutClose 的最大涨幅（%）。
 * - MAE（Maximum Adverse Excursion）：突破后某时间窗内，最低价相对
 *   breakoutClose 的最大回撤（%，负值）。
 *
 * 时间窗口从 breakoutTs 之后开始（严格 point-in-time）：
 *   窗口 = { candle.ts | breakoutTs < candle.ts <= breakoutTs + horizonMs }
 * 参考价 = breakoutClose（突破确认那根 4H K 线的收盘价）。
 *
 * 说明：breakoutTs 是突破 K 线的 open ts；突破在 close 时确认，故「突破后」取
 * ts 严格大于 breakoutTs 的已收盘 K 线。MFE/MAE 属于事后标签（label），
 * 允许使用未来数据，但绝不参与当刻的 Feature 计算。
 */
import type { Candle } from './types';
import { HOUR_MS } from './time';

export interface Excursion {
  /** 突破后时间窗内的最高价。 */
  high: number | null;
  /** 突破后时间窗内的最低价。 */
  low: number | null;
  /** (high / refPrice - 1) * 100，最大有利偏移（%）。 */
  mfe: number | null;
  /** (low / refPrice - 1) * 100，最大不利偏移（%，负值）。 */
  mae: number | null;
  /** 窗口内参与计算的已收盘 K 线根数。 */
  bars: number;
}

/**
 * 计算从 breakoutTs 之后 horizonHours 小时内的 MFE / MAE。
 * candles 须已按 ts 升序。refPrice 通常传 breakoutClose。
 */
export function calculateExcursion(
  candles: Candle[],
  breakoutTs: number,
  horizonHours: number,
  refPrice: number,
): Excursion {
  const horizonMs = horizonHours * HOUR_MS;
  const end = breakoutTs + horizonMs;
  let high: number | null = null;
  let low: number | null = null;
  let bars = 0;
  for (const b of candles) {
    if (b.ts <= breakoutTs) continue; // 突破 K 线本身与之前不参与
    if (b.ts > end) break;
    if (high == null || b.h > high) high = b.h;
    if (low == null || b.l < low) low = b.l;
    bars++;
  }
  if (high == null || low == null) {
    return { high, low, mfe: null, mae: null, bars };
  }
  return {
    high,
    low,
    mfe: (high / refPrice - 1) * 100,
    mae: (low / refPrice - 1) * 100,
    bars,
  };
}

/** MFE（%），单窗口快捷函数。 */
export function calculateMFE(
  candles: Candle[],
  breakoutTs: number,
  horizonHours: number,
  refPrice: number,
): number | null {
  return calculateExcursion(candles, breakoutTs, horizonHours, refPrice).mfe;
}

/** MAE（%），单窗口快捷函数。 */
export function calculateMAE(
  candles: Candle[],
  breakoutTs: number,
  horizonHours: number,
  refPrice: number,
): number | null {
  return calculateExcursion(candles, breakoutTs, horizonHours, refPrice).mae;
}

/** 标准突破后窗口（小时）。 */
export const EXCURSION_HORIZONS = [24, 48, 72, 168] as const; // 24h / 48h / 72h / 7D

/** 一次突破的完整 MFE/MAE 面板。 */
export interface ExcursionPanel {
  breakoutTs: number;
  refPrice: number;
  horizons: Record<string, Excursion>;
}

/** 计算一次突破在标准窗口下的完整 MFE/MAE 面板。 */
export function calculateExcursionPanel(
  candles: Candle[],
  breakoutTs: number,
  refPrice: number,
): ExcursionPanel {
  const horizons: ExcursionPanel['horizons'] = {};
  for (const h of EXCURSION_HORIZONS) {
    horizons[`${h}h`] = calculateExcursion(candles, breakoutTs, h, refPrice);
  }
  return { breakoutTs, refPrice, horizons };
}
