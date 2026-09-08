/**
 * Phase A：4H K 线时间语义 + Freshness 修正（A-TEST1 ~ A-TEST10）。
 * 纯函数，不依赖网络/UI/密钥/声音；不改任何量化策略、阈值与权重。
 * - open 语义：candleOpenTs = 区间起点 [open, open+4h)，closeTs = openTs + 4H。
 * - 期望 Bar：expected = floorTo4H(now) - 4H；actual 与之对比判 LIVE/STALE/UNAVAILABLE。
 * - STALE/UNAVAILABLE → DATA_BLOCKED，禁止沿用 BREAKOUT_TRACK / RETEST_WATCH / WATCH。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCandleFreshness,
  deriveCandleOverviewFreshness,
  deriveOverviewFreshness,
  candleMainCopy,
  CANDLE_FRESHNESS_GRACE_MS,
} from './freshness';
import { CANDLE_4H_MS, candleCloseTs, expectedLastConfirmedOpenTs, floorTo4H, isCandleClosed } from './time';
import { analyzeAssetV2 } from './v2/engine';
import { deriveActionState, actionInputFromSignal } from './action';
import type { Candle } from './types';

const H4 = CANDLE_4H_MS;
const T = (iso: string) => Date.parse(iso);

function mkBarsEnding(endOpenTs: number, n: number, price = 100): Candle[] {
  const ts0 = endOpenTs - (n - 1) * H4;
  return Array.from({ length: n }, (_, i) => ({
    ts: ts0 + i * H4,
    o: price,
    h: price + 0.5,
    l: price - 0.5,
    c: price,
    vol: 100,
    quoteVol: 100 * price,
    confirmed: true,
  }));
}

/* A-TEST1：18:20 → LIVE，「最近收盘」= 2h20m（close 口径），禁 6h20m（open 直算）。 */
test('A-TEST1：now=18:20 actual=12:00 → LIVE，最近收盘2小时20分钟前（禁6小时20分钟）', () => {
  const now = T('2026-09-08T18:20:00Z');
  const actual = T('2026-09-08T12:00:00Z');
  assert.equal(expectedLastConfirmedOpenTs(now), actual);
  const f = assessCandleFreshness(actual, now);
  assert.equal(f.status, 'LIVE');
  assert.equal(f.staleReason, null);
  assert.equal(f.candleLagBars, 0);
  assert.equal(f.actualLastConfirmedCloseTs, candleCloseTs(actual));
  assert.equal(now - (f.actualLastConfirmedCloseTs as number), 2 * 3_600_000 + 20 * 60_000);
  const copy = candleMainCopy('PEPE', actual, now, f.status);
  assert.ok(copy.includes('2小时20分钟前'), copy);
  assert.ok(!copy.includes('6小时'), copy);
});

/* A-TEST2：12:00 整点 → LIVE（actual == expected）。 */
test('A-TEST2：now=12:00 actual=08:00 → LIVE', () => {
  const now = T('2026-09-08T12:00:00Z');
  const f = assessCandleFreshness(T('2026-09-08T08:00:00Z'), now);
  assert.equal(f.status, 'LIVE');
  assert.equal(f.staleReason, null);
  assert.equal(f.expectedLastConfirmedOpenTs, T('2026-09-08T08:00:00Z'));
  assert.equal(f.expectedLastConfirmedCloseTs, now);
  assert.equal(f.current4HOpenTs, floorTo4H(now));
});

/* A-TEST3：lag1 超宽限 → STALE + DATA_BLOCKED，且禁沿用跟踪类 Action。 */
test('A-TEST3：actual=08:00落后期望(12:00)1根且超宽限 → STALE lag1 → DATA_BLOCKED', () => {
  const now = T('2026-09-08T16:31:00Z'); // expected=12:00，收盘已过31分钟 > 15分钟宽限
  const f = assessCandleFreshness(T('2026-09-08T08:00:00Z'), now);
  assert.equal(f.status, 'STALE');
  assert.equal(f.candleLagBars, 1);
  assert.equal(f.staleReason, 'latest_confirmed_candle_behind_expected_bar');
  const a = deriveActionState(
    actionInputFromSignal(null, { asset: 'PEPE', price: 100, priceTs: now, forcedStatus: 'stale', staleReason: f.detail }),
  );
  assert.equal(a.code, 'DATA_BLOCKED');
  assert.ok(!['BREAKOUT_TRACK', 'RETEST_WATCH', 'WATCH'].includes(a.code));
  assert.equal(a.keyLevels.breakoutLevel, null);
});

/* A-TEST4：未确认 4H（形成中）绝不确认：未收盘 + confirmed 过滤后 until 取已收盘末根。 */
test('A-TEST4：形成中K线未收盘，confirmed过滤后新鲜度只吃已收盘末根', () => {
  const now = T('2026-09-08T18:20:00Z');
  const formingOpen = floorTo4H(now);
  assert.equal(formingOpen, T('2026-09-08T16:00:00Z'));
  assert.equal(isCandleClosed(formingOpen, now), false);
  // 模拟 market-client 行语义：confirm=0 的最新一根只作 intraday，不进 until。
  const rows = [
    ...mkBarsEnding(T('2026-09-08T12:00:00Z'), 3),
    { ...mkBarsEnding(T('2026-09-08T16:00:00Z'), 1)[0], confirmed: false },
  ];
  const confirmed = rows.filter((r) => r.confirmed);
  const intraday = !rows.at(-1)!.confirmed ? rows.at(-1)! : null;
  const until = confirmed.length ? confirmed.at(-1)!.ts : null;
  assert.ok(intraday != null && intraday.ts === formingOpen);
  assert.equal(until, T('2026-09-08T12:00:00Z'));
  assert.equal(assessCandleFreshness(until, now).status, 'LIVE');
});

/* A-TEST5：边界宽限不误判（仅缺刚收盘一根 + 宽限期内 → LIVE）。 */
test('A-TEST5：now=12:05 actual=04:00（lag1宽限期内）→ LIVE（staleReason null）', () => {
  assert.ok(CANDLE_FRESHNESS_GRACE_MS === 15 * 60_000);
  const now = T('2026-09-08T12:05:00Z');
  const f = assessCandleFreshness(T('2026-09-08T04:00:00Z'), now);
  assert.equal(f.status, 'LIVE');
  assert.equal(f.staleReason, null);
  assert.equal(f.candleLagBars, 1);
});

/* A-TEST6：过期无 Bar（落后 ≥2 根）→ STALE，宽限不包庇。 */
test('A-TEST6：now=20:00 actual=08:00（lag2）→ STALE', () => {
  const now = T('2026-09-08T20:00:00Z');
  const f = assessCandleFreshness(T('2026-09-08T08:00:00Z'), now);
  assert.equal(f.status, 'STALE');
  assert.equal(f.candleLagBars, 2);
  assert.equal(f.staleReason, 'latest_confirmed_candle_behind_expected_bar');
});

/* A-TEST7：缺失/非法 → UNAVAILABLE（confirmed_candle_missing）→ DATA_BLOCKED。 */
test('A-TEST7：actual缺失/非法 → UNAVAILABLE → DATA_BLOCKED', () => {
  const now = T('2026-09-08T12:00:00Z');
  for (const bad of [null, NaN, -1, Infinity]) {
    const f = assessCandleFreshness(bad, now);
    assert.equal(f.status, 'UNAVAILABLE');
    assert.equal(f.staleReason, 'confirmed_candle_missing');
    assert.equal(f.candleLagBars, null);
  }
  const a = deriveActionState(
    actionInputFromSignal(null, { asset: 'DOGE', price: null, priceTs: null, forcedStatus: 'unavailable', staleReason: 'confirmed_candle_missing' }),
  );
  assert.equal(a.code, 'DATA_BLOCKED');
});

/* A-TEST8：ticker LIVE + candle STALE → 整体 stale，仍 DATA_BLOCKED。 */
test('A-TEST8：现价新鲜但K线STALE → overview stale → DATA_BLOCKED', () => {
  const now = T('2026-09-08T16:31:00Z');
  const fresh = now - 60_000;
  const f = deriveOverviewFreshness({
    okxOk: true,
    canAnalyze: true,
    lastConfirmedTs: {
      PEPE: T('2026-09-08T08:00:00Z'), // 落后期望(12:00)1根且超宽限 → STALE
      DOGE: T('2026-09-08T12:00:00Z'),
      BTC: T('2026-09-08T12:00:00Z'),
    },
    priceTs: { PEPE: fresh, DOGE: fresh, BTC: fresh },
    now,
  });
  assert.equal(f.status, 'stale');
  const a = deriveActionState(
    actionInputFromSignal(null, { asset: 'PEPE', price: 100, priceTs: fresh, forcedStatus: f.status, staleReason: f.reason }),
  );
  assert.equal(a.code, 'DATA_BLOCKED');
});

/* A-TEST9：candle LIVE + funding 缺失 → EntryHeat UNKNOWN（禁示低）。 */
test('A-TEST9：K线LIVE但funding缺失 → risk不可用 + EntryHeat未知', () => {
  const now = T('2026-09-08T12:00:00Z');
  const endOpen = expectedLastConfirmedOpenTs(now);
  const bars = mkBarsEnding(endOpen, 60, 100);
  const btc = mkBarsEnding(endOpen, 60, 50000);
  assert.equal(assessCandleFreshness(bars.at(-1)!.ts, now).status, 'LIVE');
  const sig = analyzeAssetV2('PEPE', bars, null, btc, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.risk.status, 'DATA_UNAVAILABLE');
  const a = deriveActionState(
    actionInputFromSignal(sig, { asset: 'PEPE', price: 100, priceTs: now, forcedStatus: 'ok', staleReason: null }),
  );
  assert.equal(a.entryHeat.value, null);
  assert.equal(a.entryHeat.band, '未知');
});

/* A-TEST10：三币同语义 + UI 主口径只用 closeTs（禁 openTs 直算）。 */
test('A-TEST10：三币同语义合并 + candleMainCopy按closeTs计时', () => {
  const now = T('2026-09-08T18:20:00Z');
  const open = T('2026-09-08T12:00:00Z');
  const all = deriveCandleOverviewFreshness({ PEPE: open, DOGE: open, BTC: open }, now);
  assert.equal(all.status, 'LIVE');
  assert.equal(all.staleReason, null);
  assert.equal(all.expectedLastConfirmedOpenTs, open);
  assert.equal(all.expectedLastConfirmedCloseTs, open + H4);
  assert.equal(all.current4HOpenTs, floorTo4H(now));
  const oneStale = deriveCandleOverviewFreshness(
    { PEPE: T('2026-09-08T08:00:00Z'), DOGE: open, BTC: open },
    T('2026-09-08T20:00:00Z'),
  );
  assert.equal(oneStale.status, 'STALE');
  // UI 主口径：年龄恒等于 now - closeTs（openTs + 4H），与 open 直算差整 4h。
  for (const coin of ['PEPE', 'DOGE', 'BTC'] as const) {
    const copy = candleMainCopy(coin, open, now, 'LIVE');
    assert.ok(copy.startsWith(`K线${coin}·LIVE·最近收盘`), copy);
    assert.ok(copy.includes('2小时20分钟前'), copy);
  }
});
