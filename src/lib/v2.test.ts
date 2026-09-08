import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getRollingHigh, detectBreakoutAt, detectBreakout, detectAllBreakouts } from './breakout';
import { parseCSTDate, floorTo4H, CANDLE_4H_MS } from './time';
import { calculateExcursion } from './mfe-mae';
import { computePostBreakoutFeatures, analyzeAssetV2 } from './v2/engine';
import { SIMILARITY_FEATURES } from './similarity';
import { walkForwardBacktest } from './v2/backtest';
import { DEFAULT_CONFIG } from './config';
import type { Candle } from './types';
import type { BreakoutSample } from './v2/samples';

const mk = (ts: number, o: number, h: number, l: number, c: number, quoteVol = 100): Candle => ({
  ts,
  o,
  h,
  l,
  c,
  vol: 1,
  quoteVol,
  confirmed: true,
});

/** 单调上升 K 线：h/c 递增，不会有 rolling 突破（除非 step 很大）。 */
function rising(n: number, base = 100, step = 1, ts0 = 0, vol = 100): Candle[] {
  return Array.from({ length: n }, (_, i) =>
    mk(ts0 + i * CANDLE_4H_MS, base + i * step, base + i * step + step, base + i * step - step * 0.5, base + i * step + step * 0.5, vol),
  );
}

/* ------------------------------------------------------------------ */
/* TEST 1：Rolling 7D High 不包含当前 K 线                              */
/* ------------------------------------------------------------------ */
test('TEST 1：rollingHigh 不包含当前 K 线', () => {
  const n = 50;
  const candles = Array.from({ length: n }, (_, i) => mk(i * CANDLE_4H_MS, i, i + 1, i - 1, i + 0.5));
  // 下标 42 这根的高是 43，但 rollingHigh 只取前 42 根（high 1..42），故应为 42
  assert.equal(getRollingHigh(candles, 42, 42), 42);
  assert.equal(getRollingHigh(candles, 42, 42) !== candles[42].h, true);
});

/* ------------------------------------------------------------------ */
/* TEST 2：突破只有在 4H 收盘（close > rollingHigh）后才成立            */
/* ------------------------------------------------------------------ */
test('TEST 2：盘中 high 突破但 close 未突破不算突破', () => {
  const candles = rising(42, 100, 1); // 基线 42 根，h[41] = 142
  // 第 43 根（下标 42）：high 143（略高于阻力 142），但 close 141 回落到阻力下方 → 不算突破
  candles.push(mk(42 * CANDLE_4H_MS, 141, 143, 140, 141));
  assert.equal(detectBreakoutAt(candles, 42, { lookbackCandles: 42 }), null);

  // 真正收盘突破：close 144 > rollingHigh（现含 fake 的 high 143）
  candles.push(mk(43 * CANDLE_4H_MS, 142, 145, 141, 144));
  const sig = detectBreakoutAt(candles, 43, { lookbackCandles: 42 });
  assert.ok(sig != null);
  assert.equal(sig.close, 144);
  assert.equal(sig.level, 143);
});

/* ------------------------------------------------------------------ */
/* TEST 3：突破前不能产生 Follow-through                                */
/* ------------------------------------------------------------------ */
test('TEST 3：未突破时 Follow-through = NOT_STARTED', () => {
  const candles = rising(60, 100, -0.1); // 缓慢下行，无突破
  const btc = rising(60, 50000, -1);
  const sig = analyzeAssetV2('PEPE', candles, null, btc, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.trigger.status, 'WAITING');
  assert.equal(sig.followThrough.status, 'NOT_STARTED');
  assert.equal(sig.followThrough.value, null);
});

/* ------------------------------------------------------------------ */
/* TEST 4：突破后 24H Volume 从 breakoutTs 开始计算                     */
/* ------------------------------------------------------------------ */
test('TEST 4：Follow-through 24h 量能从 breakoutTs 之后起算（不含突破 K 线）', () => {
  // 平坦基线 42 根，量 100
  const flat = (n: number, price = 100, vol = 100): Candle[] =>
    Array.from({ length: n }, (_, i) => mk(i * CANDLE_4H_MS, price, price + 0.5, price - 0.5, price, vol));
  const candles = flat(42, 100, 100);
  const brk = mk(42 * CANDLE_4H_MS, 100, 105, 99.5, 104, 10000); // 突破 K 线，量 10000
  candles.push(brk);
  // 突破后 6 根，量 200（平坦，不产生新突破）
  for (let i = 1; i <= 6; i++) {
    candles.push(mk((42 + i) * CANDLE_4H_MS, 104, 104.5, 103.5, 104, 200));
  }
  const feat = computePostBreakoutFeatures(candles, [], DEFAULT_CONFIG.thresholds);
  assert.ok(feat.breakout != null);
  assert.ok(feat.followThrough24hVolRatio != null);
  // 基线中位数 = 100；突破后 6 根均量 = 200 → 24h 量比 = 2.0（不含突破 K 线 10000）
  assert.ok(Math.abs(feat.followThrough24hVolRatio! - 2.0) < 1e-9);
});

/* ------------------------------------------------------------------ */
/* TEST 5：时区转换不会移动 4H K 线边界                                 */
/* ------------------------------------------------------------------ */
test('TEST 5：CST 日期解析保持 4H 边界对齐，两天相差恰 24h', () => {
  const a = parseCSTDate('2026-02-09');
  const b = parseCSTDate('2026-02-10');
  assert.equal(b - a, 86_400_000);
  assert.equal(a % CANDLE_4H_MS, 0);
  assert.equal(b % CANDLE_4H_MS, 0);
  assert.equal(floorTo4H(a), a); // 本就是边界
});

/* ------------------------------------------------------------------ */
/* TEST 6：历史相似度不使用未来数据                                     */
/* ------------------------------------------------------------------ */
test('TEST 6：相似度特征仅含突破前字段，无任何突破后信息', () => {
  const keys = SIMILARITY_FEATURES.map((f) => f.key);
  const allowed = new Set(['compressionRatio', 'preVolumeRatio', 'preReturnPct', 'preAtrPct', 'preFundingAvgPct']);
  for (const k of keys) assert.ok(allowed.has(k as string), `${k} 不应作为相似度特征`);
});

/* ------------------------------------------------------------------ */
/* TEST 7：Walk-forward 时间单调，同轮行情不跨 Train/Test               */
/* ------------------------------------------------------------------ */
test('TEST 7：walk-forward 每个 fold 的 train 严格早于 test', () => {
  const mkSample = (ts: number): BreakoutSample => ({
    coin: 'PEPE',
    ts,
    level: 100,
    close: 101,
    distancePct: 1,
    volumeRatio: 1.5,
    mfe24h: 5,
    mae24h: -2,
    mfe48h: 8,
    mae48h: -3,
    mfe72h: 12,
    mae72h: -4,
    mfe7d: 15,
    mae7d: -6,
    outcome: 'success',
    campaignId: null,
  });
  const samples: BreakoutSample[] = Array.from({ length: 40 }, (_, i) => mkSample(i * 86_400_000));
  const folds = walkForwardBacktest(samples, 4);
  assert.ok(folds.length > 0);
  for (const f of folds) {
    assert.ok(f.trainTo < f.testFrom, 'train 时间区间必须早于 test');
  }
});

/* ------------------------------------------------------------------ */
/* TEST 8：Missing Data 不会被当成 Score = 0                            */
/* ------------------------------------------------------------------ */
test('TEST 8：数据不足 → DATA_VETO（不会被当成 0 分）', () => {
  const candles = rising(10, 100, -1); // 仅 10 根且下行，无突破
  const btc = rising(10, 50000, -1);
  const sig = analyzeAssetV2('PEPE', candles, null, btc, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.hardVeto.kind, 'DATA_VETO');
  assert.equal(sig.state, 'MARKET_BLOCKED');
  // 未发生突破时，Trigger / Follow-through 不产生 0 分
  assert.equal(sig.trigger.value, null);
  assert.equal(sig.followThrough.value, null);
});

/* ------------------------------------------------------------------ */
/* TEST 9：Hard Veto 覆盖高机会/高蓄势状态                              */
/* ------------------------------------------------------------------ */
test('TEST 9：BTC 硬破位 → BTC_VETO + MARKET_BLOCKED（无视蓄势）', () => {
  const candles = rising(60, 100, 2); // 强上升，蓄势强
  // BTC：前 54 根平稳，最后 6 根急跌 15%
  const btc: Candle[] = rising(54, 50000, 0.1);
  let p = 50005;
  for (let i = 0; i < 6; i++) {
    p *= 0.96;
    btc.push(mk((54 + i) * CANDLE_4H_MS, p * 1.01, p * 1.02, p, p * 1.0));
  }
  const sig = analyzeAssetV2('PEPE', candles, null, btc, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.hardVeto.kind, 'BTC_VETO');
  assert.equal(sig.state, 'MARKET_BLOCKED');
});

/* ------------------------------------------------------------------ */
/* TEST 10：实时与历史 breakout detector 输出一致                       */
/* ------------------------------------------------------------------ */
test('TEST 10：detectBreakout（实时）与 detectAllBreakouts（历史）一致', () => {
  const candles = rising(100, 100, 1);
  // 在 50、75 附近制造两次突破
  candles[50] = mk(50 * CANDLE_4H_MS, 150, 200, 149, 180, 5000);
  candles[75] = mk(75 * CANDLE_4H_MS, 180, 250, 179, 220, 5000);
  const all = detectAllBreakouts(candles, { lookbackCandles: 42 });
  const last = detectBreakout(candles, { lookbackCandles: 42 });
  assert.ok(all.length >= 1);
  assert.ok(last != null);
  // 实时给出的「最近一次突破」应等于历史扫描的最后一次突破
  assert.equal(last.ts, all.at(-1)!.ts);
  assert.equal(last.index, all.at(-1)!.index);
});

/* ------------------------------------------------------------------ */
/* 附：MFE/MAE 从 breakoutTs 之后起算，不含突破 K 线                    */
/* ------------------------------------------------------------------ */
test('MFE/MAE 窗口不含突破 K 线本身', () => {
  const candles = rising(42, 100, 1);
  const brk = mk(42 * CANDLE_4H_MS, 140, 145, 139, 144); // 突破 K 线 high 145
  candles.push(brk);
  candles.push(mk(43 * CANDLE_4H_MS, 144, 150, 143, 149)); // 突破后最高 150
  const ex = calculateExcursion(candles, brk.ts, 24, brk.c);
  // 窗口只含突破后那根（150），不含突破 K 线的 145
  assert.equal(ex.high, 150);
  assert.equal(ex.bars, 1);
});
