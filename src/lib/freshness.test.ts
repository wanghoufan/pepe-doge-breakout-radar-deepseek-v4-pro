/**
 * P0 可靠性整改测试（P0-1 ~ P0-4，故障演练）。
 * 纯函数，不依赖网络/UI/密钥/声音。
 * - P0-1：STALE 三态 + freshness 字段（ok/stale/unavailable，如实携带最后更新）。
 * - P0-2：缺数据禁示低风险（Risk 任一 unknown / funding 缺失或过期 → DATA_UNAVAILABLE）。
 * - P0-3：来源新鲜度行单源判定（每路独立 ok/stale/unavailable）。
 * - P0-4：故障演练（feed 缺失 / stale / funding 故障 / K 线不足，各自降级且不冒充、不示低风险）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessFeedFreshness,
  assessFundingFreshness,
  deriveOverviewFreshness,
  CANDLE_STALE_AFTER_MS,
  FUNDING_STALE_AFTER_MS,
} from './freshness';
import { resolveRiskLayer, analyzeAssetV2 } from './v2/engine';
import { deriveActionState, actionInputFromSignal, type ActionInput } from './action';
import type { Candle } from './types';

const H4 = 4 * 3_600_000;
const NOW = Date.parse('2026-09-08T12:00:00Z');

function baseAction(over: Partial<ActionInput> = {}): ActionInput {
  return {
    dataStatus: 'ok',
    lastUpdatedTs: NOW,
    staleReason: null,
    environmentGate: 'ALLOW',
    hardVetoKind: 'NONE',
    hardVetoReason: null,
    state: 'NO_SETUP',
    entryHeat: 10,
    currentPrice: 0.09,
    breakoutConfirmed: false,
    breakoutLevel: null,
    breakoutClose: null,
    breakoutExtensionPct: null,
    currentDistancePct: null,
    invalidationLevel: null,
    nextResistance: 0.095,
    breakoutTs: null,
    episodeAgeHours: null,
    episodeId: null,
    heldAboveBreakoutLevel: null,
    setupScore: null,
    triggerScore: null,
    followThroughStatus: 'NOT_STARTED',
    followThroughValue: null,
    ...over,
  };
}

function mkCandles(n: number, price = 100, ts0 = NOW - n * H4): Candle[] {
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

/* ---------------- P0-1：单路三态 ---------------- */

test('P0-1a：无时间戳 → unavailable（不沿用旧信号）', () => {
  const f = assessFeedFreshness(null, NOW);
  assert.equal(f.status, 'unavailable');
  assert.equal(f.lastUpdatedTs, null);
  assert.ok(f.reason != null);
});

test('P0-1b：新鲜 → ok（携带最后更新）', () => {
  const f = assessFeedFreshness(NOW - 60_000, NOW);
  assert.equal(f.status, 'ok');
  assert.equal(f.lastUpdatedTs, NOW - 60_000);
  assert.equal(f.reason, null);
});

test('P0-1c：超 8h 未更新 → stale（携带最后更新+原因）', () => {
  const old = NOW - CANDLE_STALE_AFTER_MS - 1;
  const f = assessFeedFreshness(old, NOW);
  assert.equal(f.status, 'stale');
  assert.equal(f.lastUpdatedTs, old);
  assert.ok(f.reason != null);
});

test('P0-1d：恰好 8h 边界仍判 ok（> 才 stale）', () => {
  const f = assessFeedFreshness(NOW - CANDLE_STALE_AFTER_MS, NOW);
  assert.equal(f.status, 'ok');
});

/* ---------------- P0-1：overview 三态 ---------------- */

function overviewInput(over: Record<string, unknown> = {}) {
  return {
    okxOk: true,
    canAnalyze: true,
    lastConfirmedTs: { PEPE: NOW - H4, DOGE: NOW - H4, BTC: NOW - H4 },
    priceTs: { PEPE: NOW - 60_000, DOGE: NOW - 60_000, BTC: NOW - 60_000 },
    now: NOW,
    ...over,
  };
}

test('P0-1e：overview 新鲜 → ok', () => {
  const f = deriveOverviewFreshness(overviewInput());
  assert.equal(f.status, 'ok');
  assert.ok(f.lastUpdatedTs != null);
});

test('P0-1f：overview 任一必需时间戳缺失 → unavailable', () => {
  const f = deriveOverviewFreshness(
    overviewInput({ lastConfirmedTs: { PEPE: null, DOGE: NOW - H4, BTC: NOW - H4 } }),
  );
  assert.equal(f.status, 'unavailable');
});

test('P0-1g：overview K 线停更超 8h → stale', () => {
  const old = NOW - CANDLE_STALE_AFTER_MS - H4;
  const f = deriveOverviewFreshness(
    overviewInput({ lastConfirmedTs: { PEPE: old, DOGE: old, BTC: old } }),
  );
  assert.equal(f.status, 'stale');
  assert.equal(f.lastUpdatedTs, old);
});

test('P0-1h：overview feed 级失败 → unavailable（不降级为 stale）', () => {
  assert.equal(deriveOverviewFreshness(overviewInput({ okxOk: false })).status, 'unavailable');
  assert.equal(deriveOverviewFreshness(overviewInput({ canAnalyze: false })).status, 'unavailable');
});

test('P0-1i：stale 同样走 DATA_BLOCKED（不沿用旧信号，关键价位清空）', () => {
  const a = deriveActionState(baseAction({ dataStatus: 'stale', staleReason: '数据已过期约 9h', lastUpdatedTs: NOW - 9 * 3_600_000 }));
  assert.equal(a.code, 'DATA_BLOCKED');
  assert.equal(a.dataFreshness.status, 'stale');
  assert.equal(a.keyLevels.breakoutLevel, null);
  assert.ok(a.summary.includes('暂停判断'));
});

test('P0-1j：unavailable 同样走 DATA_BLOCKED', () => {
  const a = deriveActionState(baseAction({ dataStatus: 'unavailable', staleReason: 'OKX 实时数据当前不可用' }));
  assert.equal(a.code, 'DATA_BLOCKED');
  assert.equal(a.dataFreshness.status, 'unavailable');
});

/* ---------------- P0-2：缺数据禁示低风险 ---------------- */

test('P0-2a：funding 缺失 → Risk DATA_UNAVAILABLE（禁示低）', () => {
  const r = resolveRiskLayer(0, [], 'unavailable', null);
  assert.equal(r.status, 'DATA_UNAVAILABLE');
  assert.equal(r.value, null);
});

test('P0-2b：任一 Risk 条件 unknown → DATA_UNAVAILABLE（即使分值 0 也不示低）', () => {
  const r = resolveRiskLayer(0, [{ unknown: false }, { unknown: true }], 'ok', 0.01);
  assert.equal(r.status, 'DATA_UNAVAILABLE');
  assert.equal(r.value, null);
});

test('P0-2c：funding 过期（stale）→ DATA_UNAVAILABLE', () => {
  const r = resolveRiskLayer(5, [{ unknown: false }], 'stale', 0.01);
  assert.equal(r.status, 'DATA_UNAVAILABLE');
});

test('P0-2d：数据齐全 → COMPUTED（保留原分值）', () => {
  const r = resolveRiskLayer(12, [{ unknown: false }], 'ok', 0.01);
  assert.equal(r.status, 'COMPUTED');
  assert.equal(r.value, 12);
});

test('P0-2e（集成）：引擎 funding 缺失 → risk 不可用 + EntryHeat 未知', () => {
  const bars = mkCandles(60, 100);
  const btc = mkCandles(60, 50000);
  const sig = analyzeAssetV2('PEPE', bars, null, btc, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.risk.status, 'DATA_UNAVAILABLE');
  assert.equal(sig.risk.value, null);
  const action = deriveActionState(
    actionInputFromSignal(sig, { asset: 'PEPE', price: 100, priceTs: NOW, forcedStatus: 'ok', staleReason: null }),
  );
  assert.equal(action.entryHeat.value, null);
  assert.equal(action.entryHeat.band, '未知');
});

test('P0-2f（集成）：引擎 funding 过期 → risk 不可用 + staleFields 含 funding', () => {
  const bars = mkCandles(60, 100);
  const btc = mkCandles(60, 50000);
  const barsLast = bars[bars.length - 1].ts;
  const staleFunding = [{ ts: barsLast - FUNDING_STALE_AFTER_MS - H4, rate: 0.0001 }];
  const sig = analyzeAssetV2('PEPE', bars, null, btc, staleFunding, { peerRelativeStrengthPct: null });
  assert.equal(sig.risk.status, 'DATA_UNAVAILABLE');
  assert.ok(sig.dataQuality.staleFields.includes('funding'));
  assert.equal(sig.dataQuality.degraded, true);
});

test('P0-2g（集成）：引擎数据齐全 → risk 可用（不误杀）', () => {
  const bars = mkCandles(60, 100);
  const btc = mkCandles(60, 50000);
  const barsLast = bars[bars.length - 1].ts;
  const freshFunding = Array.from({ length: 5 }, (_, i) => ({ ts: barsLast - (4 - i) * 8 * 3_600_000, rate: 0.0001 }));
  const sig = analyzeAssetV2('PEPE', bars, null, btc, freshFunding, { peerRelativeStrengthPct: null });
  assert.equal(sig.risk.status, 'COMPUTED');
  assert.ok(sig.risk.value != null);
});

/* ---------------- P0-3：来源新鲜度每路独立 ---------------- */

test('P0-3a：现价缺失仅该路 unavailable，不污染 K 线路', () => {
  const kline = assessFeedFreshness(NOW - H4, NOW, CANDLE_STALE_AFTER_MS);
  const price = assessFeedFreshness(null, NOW, CANDLE_STALE_AFTER_MS);
  assert.equal(kline.status, 'ok');
  assert.equal(price.status, 'unavailable');
});

test('P0-3b：资金费率用 24h 口径（8h 旧仍 ok，25h 旧才 stale）', () => {
  assert.equal(assessFeedFreshness(NOW - 8 * 3_600_000, NOW, FUNDING_STALE_AFTER_MS).status, 'ok');
  assert.equal(assessFeedFreshness(NOW - 25 * 3_600_000, NOW, FUNDING_STALE_AFTER_MS).status, 'stale');
});

/* ---------------- P0-4：故障演练 ---------------- */

test('P0-4a 演练：OKX 全断 → overview unavailable → 双币 Action DATA_BLOCKED', () => {
  const f = deriveOverviewFreshness(overviewInput({ okxOk: false, canAnalyze: false }));
  assert.equal(f.status, 'unavailable');
  for (const asset of ['PEPE', 'DOGE'] as const) {
    const input = actionInputFromSignal(null, { asset, price: null, priceTs: null, forcedStatus: f.status, staleReason: f.reason });
    const a = deriveActionState(input);
    assert.equal(a.code, 'DATA_BLOCKED');
    assert.equal(a.keyLevels.breakoutLevel, null);
  }
});

test('P0-4b 演练：K 线停更（stale）但 signals 仍在 → 强制 DATA_BLOCKED，不沿用旧突破', () => {
  const old = NOW - 10 * 3_600_000;
  const f = deriveOverviewFreshness(
    overviewInput({ lastConfirmedTs: { PEPE: old, DOGE: old, BTC: old } }),
  );
  assert.equal(f.status, 'stale');
  const bars = mkCandles(60, 100);
  const btc = mkCandles(60, 50000);
  const freshFunding = [{ ts: bars[bars.length - 1].ts - 60_000, rate: 0.0001 }];
  const sig = analyzeAssetV2('PEPE', bars, null, btc, freshFunding, { peerRelativeStrengthPct: null });
  const a = deriveActionState(
    actionInputFromSignal(sig, { asset: 'PEPE', price: 100, priceTs: old, forcedStatus: f.status, staleReason: f.reason }),
  );
  assert.equal(a.code, 'DATA_BLOCKED');
  assert.equal(a.dataFreshness.status, 'stale');
});

test('P0-4c 演练：funding 全断 → overview 仍可 live，但 EntryHeat 必须未知（禁示低）', () => {
  const bars = mkCandles(60, 100);
  const btc = mkCandles(60, 50000);
  const sig = analyzeAssetV2('PEPE', bars, null, btc, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.risk.status, 'DATA_UNAVAILABLE');
  const a = deriveActionState(
    actionInputFromSignal(sig, { asset: 'PEPE', price: 100, priceTs: NOW, forcedStatus: 'ok', staleReason: null }),
  );
  assert.equal(a.entryHeat.band, '未知');
  assert.ok(a.entryHeat.value == null);
});

test('P0-4d 演练：K 线不足 20 根 → DATA_VETO + MARKET_BLOCKED（不产 0 分）', () => {
  const tiny = mkCandles(5, 100);
  const btcTiny = mkCandles(5, 50000);
  const sig = analyzeAssetV2('PEPE', tiny, null, btcTiny, [], { peerRelativeStrengthPct: null });
  assert.equal(sig.hardVeto.kind, 'DATA_VETO');
  assert.equal(sig.state, 'MARKET_BLOCKED');
  assert.equal(sig.trigger.value, null);
});

test('P0-4e 演练：funding 时间戳非法/空 → assessFundingFreshness unavailable', () => {
  assert.equal(assessFundingFreshness([], NOW).status, 'unavailable');
  assert.equal(assessFundingFreshness([{ ts: NaN }], NOW).status, 'unavailable');
});
