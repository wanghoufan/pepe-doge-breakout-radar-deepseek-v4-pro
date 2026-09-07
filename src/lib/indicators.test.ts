import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pct,
  avg,
  median,
  maxDrawdown,
  emaSeries,
  emaAt,
  trueRange,
  atrSeries,
  meanTrueRangePct,
  rangeStats,
  smaSeries,
  slope,
} from './indicators';
import type { Candle } from './types';

const c = (o: number, h: number, l: number, cl: number, ts = 0, quoteVol = 1): Candle => ({
  ts,
  o,
  h,
  l,
  c: cl,
  vol: 1,
  quoteVol,
  confirmed: true,
});

test('pct 计算百分比变化', () => {
  assert.ok(Math.abs(pct(120, 100) - 20) < 1e-9);
  assert.ok(Math.abs(pct(80, 100) + 20) < 1e-9);
  assert.equal(pct(100, 100), 0);
});

test('avg 与 median', () => {
  assert.equal(avg([1, 2, 3, 4, 5]), 3);
  assert.equal(avg([]), null);
  assert.equal(median([1, 2, 3, 4, 5]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
});

test('maxDrawdown 从峰值回撤为负值', () => {
  const bars = [c(100, 110, 90, 100), c(100, 120, 60, 70)];
  // 峰值 120，回撤到 60：60/120 - 1 = -50%
  assert.equal(maxDrawdown(bars), -50);
});

test('emaSeries 以首值为种子', () => {
  const s = emaSeries([1, 2, 3, 4, 5], 3);
  assert.equal(s[0], 1);
  assert.ok(Math.abs(s[1] - 1.5) < 1e-9);
  assert.ok(Math.abs(s[2] - 2.25) < 1e-9);
  assert.ok(Math.abs(s[3] - 3.125) < 1e-9);
  assert.equal(s.length, 5);
});

test('emaAt 只取 endTs 之前的收盘价', () => {
  const bars = [
    c(1, 1, 1, 2, 1000),
    c(1, 1, 1, 4, 2000),
    c(1, 1, 1, 6, 3000),
    c(1, 1, 1, 8, 4000),
  ];
  // 取 ts < 3000 的收盘 [2,4]，周期 3：2, 4*0.5+2*0.5=3
  assert.equal(emaAt(bars, 3, 3000), 3);
});

test('trueRange 取三者最大', () => {
  const bar = c(10, 15, 8, 12);
  assert.equal(trueRange(bar, 9), 7); // max(15-8=7, |15-9|=6, |8-9|=1)
});

test('atrSeries 为 Wilder 平滑', () => {
  const bars = [
    c(10, 12, 9, 11),
    c(11, 13, 10, 12),
  ];
  const tr1 = 12 - 9; // 3
  const tr2 = Math.max(13 - 10, Math.abs(13 - 11), Math.abs(10 - 11)); // 3
  const atr = atrSeries(bars, 14);
  assert.equal(atr[0], tr1);
  // Wilder: (3 * 13 + 3) / 14
  assert.ok(Math.abs(atr[1] - (tr1 * 13 + tr2) / 14) < 1e-9);
});

test('meanTrueRangePct 输出百分比', () => {
  const bars = [c(100, 110, 95, 105), c(105, 115, 100, 110)];
  // 第二根相对前收 105：TR = max(15, |115-105|=10, |100-105|=5)=15 → 15/105*100
  const r = meanTrueRangePct(bars);
  assert.ok(r !== null);
  assert.ok(Math.abs(r - (15 / 105) * 100) < 1e-6);
});

test('rangeStats 汇总区间高低开收', () => {
  const bars = [c(10, 20, 5, 15), c(15, 18, 8, 12)];
  const r = rangeStats(bars);
  assert.deepEqual(r, { high: 20, low: 5, open: 10, close: 12 });
});

test('smaSeries 前 period-1 个为 NaN', () => {
  const s = smaSeries([1, 2, 3, 4], 3);
  assert.ok(Number.isNaN(s[0]));
  assert.ok(Number.isNaN(s[1]));
  assert.equal(s[2], 2);
  assert.equal(s[3], 3);
});

test('slope 计算线性斜率', () => {
  // 严格线性递增 [1,2,3,4,5]，每步 +1
  assert.equal(slope([1, 2, 3, 4, 5], 5), 1);
  // 不足 2 个点返回 null
  assert.equal(slope([1], 1), null);
});