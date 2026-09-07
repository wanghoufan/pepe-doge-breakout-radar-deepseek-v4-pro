/**
 * 指标纯函数库。所有计算与 UI 解耦，输入相同则输出相同。
 *
 * 计算口径与资料包 `04_分析脚本/analyze_breakouts.mjs` 保持一致，
 * 便于用 `event-metrics.json` 做回归测试，防止实现错误改变历史数值。
 */
import type { Candle } from './types';

/** (a / b - 1) * 100，百分比变化。 */
export function pct(a: number, b: number): number {
  return (a / b - 1) * 100;
}

export function avg(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const ys = [...xs].sort((a, b) => a - b);
  const m = Math.floor(ys.length / 2);
  return ys.length % 2 ? ys[m] : (ys[m - 1] + ys[m]) / 2;
}

/** 峰值回撤（%）：从历史高点回看，最低点到高点的百分比跌幅（负数）。 */
export function maxDrawdown(candles: Pick<Candle, 'h' | 'l'>[]): number {
  let peak = -Infinity;
  let dd = 0;
  for (const b of candles) {
    peak = Math.max(peak, b.h);
    dd = Math.min(dd, pct(b.l, peak));
  }
  return dd;
}

/**
 * EMA 序列。以首个值为种子（与资料包脚本一致），返回与 values 等长的序列。
 */
export function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out = new Array<number>(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

/** 在给定收盘价序列（含时间）中，取截止 endTs（不含）前的 EMA 值。 */
export function emaAt(
  candles: Pick<Candle, 'ts' | 'c'>[],
  period: number,
  endTs: number,
): number | null {
  const closes = candles.filter((c) => c.ts < endTs).map((c) => c.c);
  if (!closes.length) return null;
  return emaSeries(closes, period).at(-1) ?? null;
}

/** 单根 true range（价格单位），用于 Wilder ATR。 */
export function trueRange(
  c: Pick<Candle, 'h' | 'l'>,
  prevClose: number,
): number {
  return Math.max(c.h - c.l, Math.abs(c.h - prevClose), Math.abs(c.l - prevClose));
}

/**
 * Wilder ATR（价格单位），返回与 candles 等长的序列（首个值为第一根 TR）。
 */
export function atrSeries(candles: Pick<Candle, 'h' | 'l' | 'c'>[], period: number): number[] {
  if (candles.length === 0) return [];
  const trs = [candles[0].h - candles[0].l];
  for (let i = 1; i < candles.length; i++) {
    trs.push(trueRange(candles[i], candles[i - 1].c));
  }
  const out = new Array<number>(candles.length);
  out[0] = trs[0];
  for (let i = 1; i < trs.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  return out;
}

/**
 * 平均 true range 百分比（%），与资料包 `atrPercent` 一致：
 * 对相邻 K 线计算 TR / 前收 * 100 后取平均。
 */
export function meanTrueRangePct(candles: Pick<Candle, 'h' | 'l' | 'c'>[]): number | null {
  if (candles.length < 2) return null;
  const trPcts: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].c;
    trPcts.push((trueRange(candles[i], prev) / prev) * 100);
  }
  return avg(trPcts);
}

/** 区间内的最高 / 最低 / 首开 / 末收。 */
export function rangeStats(candles: Pick<Candle, 'o' | 'h' | 'l' | 'c'>[]) {
  if (!candles.length) return null;
  return {
    high: Math.max(...candles.map((b) => b.h)),
    low: Math.min(...candles.map((b) => b.l)),
    open: candles[0].o,
    close: candles.at(-1)!.c,
  };
}

/** 简单移动平均（用于相对强度平滑等）。 */
export function smaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** 线性回归斜率（对最近 N 个点），返回每单位步长的变化率。 */
export function slope(values: number[], n: number): number | null {
  const xs = values.slice(-n);
  if (xs.length < 2) return null;
  const meanX = (xs.length - 1) / 2;
  const meanY = avg(xs)!;
  let num = 0;
  let den = 0;
  xs.forEach((y, i) => {
    num += (i - meanX) * (y - meanY);
    den += (i - meanX) * (i - meanX);
  });
  if (den === 0) return null;
  return num / den;
}

/** 归一化：把序列映射到 [0,1]（按 min/max）。空或全相等返回 null。 */
export function normMinMax(values: number[]): number[] | null {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return null;
  return values.map((v) => (v - min) / (max - min));
}