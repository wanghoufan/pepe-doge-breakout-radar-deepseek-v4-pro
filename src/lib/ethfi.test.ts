/**
 * ETHFI 接入测试（与 PEPE/DOGE 同框架同标准）。
 * 纯函数，不依赖网络/UI/密钥/声音；禁编造任何研究基线数据。
 *
 * 四件套：
 * 1) freshness：ETHFI 纳入 K 线/现价合并（STALE/UNAVAILABLE 传播、grace 宽限同标准）；
 *    旧三币调用（无 ETHFI 键）判定不变。
 * 2) alert：AlertCoin 含 ETHFI；默认订阅同 DOGE；alertKey/状态变化/TEST 隔离同标准。
 * 3) market：OKX/Binance symbol 映射 + 精度适配 formatPrice + 无快照基线诚实为空。
 * 4) B-TEST 同标准：ETHFI 沿用默认订阅/禁语/去重/ACK 语义；引擎阈值权重零改动（Quant 审计）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSETS, DEFAULT_V2_THRESHOLDS, DEFAULT_V2_WEIGHTS } from './config';
import { MARKET_META } from './market-client';
import { formatPrice } from './format';
import { getSnapshotCandles, getSnapshotFunding } from './data-store';
import { deriveCandleOverviewFreshness, deriveOverviewFreshness, CANDLE_FRESHNESS_GRACE_MS } from './freshness';
import { expectedLastConfirmedOpenTs, floorTo4H } from './time';
import {
  DEFAULT_SUBSCRIPTIONS,
  DEFAULT_ALERT_SETTINGS,
  BANNED_COPY_WORDS,
  ALERT_COPY,
  buildAlertKey,
  shouldCreateAlert,
  pushHistory,
  sanitizeSettings,
  isTestAlertKey,
  TEST_ALERT_EPISODE_ID,
  type AlertRecord,
} from './alert-center';
import { analyzeAssetV2 } from './v2/engine';
import type { Candle } from './types';

const H4 = 4 * 3_600_000;
const NOW = Date.parse('2026-09-08T12:00:00Z');
const freshOpen = expectedLastConfirmedOpenTs(NOW);

function mkCandles(n: number, price = 0.58, ts0 = NOW - n * H4): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    ts: ts0 + i * H4,
    o: price,
    h: price * 1.01,
    l: price * 0.99,
    c: price * (1 + (i % 5) * 0.001),
    vol: 1000 + i,
    quoteVol: 580 + i,
    confirmed: true,
  }));
}

/* ---------------- 1) freshness ---------------- */

test('ETHFI-FRESH1：四币全 LIVE 时 overview 为 ok', () => {
  const r = deriveOverviewFreshness({
    okxOk: true,
    canAnalyze: true,
    lastConfirmedTs: { PEPE: freshOpen, DOGE: freshOpen, BTC: freshOpen, ETHFI: freshOpen },
    priceTs: { PEPE: NOW - 60_000, DOGE: NOW - 60_000, BTC: NOW - 60_000, ETHFI: NOW - 60_000 },
    now: NOW,
  });
  assert.equal(r.status, 'ok');
});

test('ETHFI-FRESH2：ETHFI 单币 STALE 传播到 overview（与 DOGE 同标准）', () => {
  const staleOpen = freshOpen - 3 * H4; // 落后 3 根，宽限外 → STALE
  const r = deriveOverviewFreshness({
    okxOk: true,
    canAnalyze: true,
    lastConfirmedTs: { PEPE: freshOpen, DOGE: freshOpen, BTC: freshOpen, ETHFI: staleOpen },
    priceTs: { PEPE: NOW - 60_000, DOGE: NOW - 60_000, BTC: NOW - 60_000, ETHFI: NOW - 60_000 },
    now: NOW,
  });
  assert.equal(r.status, 'stale');
});

test('ETHFI-FRESH3：ETHFI 缺失（null）→ UNAVAILABLE，不沿用旧信号', () => {
  const r = deriveOverviewFreshness({
    okxOk: true,
    canAnalyze: true,
    lastConfirmedTs: { PEPE: freshOpen, DOGE: freshOpen, BTC: freshOpen, ETHFI: null },
    priceTs: { PEPE: NOW - 60_000, DOGE: NOW - 60_000, BTC: NOW - 60_000, ETHFI: NOW - 60_000 },
    now: NOW,
  });
  assert.equal(r.status, 'unavailable');
});

test('ETHFI-FRESH4：旧三币调用（无 ETHFI 键）判定不变', () => {
  const r = deriveOverviewFreshness({
    okxOk: true,
    canAnalyze: true,
    lastConfirmedTs: { PEPE: freshOpen, DOGE: freshOpen, BTC: freshOpen },
    priceTs: { PEPE: NOW - 60_000, DOGE: NOW - 60_000, BTC: NOW - 60_000 },
    now: NOW,
  });
  assert.equal(r.status, 'ok');
});

test('ETHFI-FRESH5：收盘宽限期内仅缺刚收盘一根仍 LIVE（grace 同标准）', () => {
  const expectedClose = freshOpen + H4;
  const justClosed = NOW - expectedClose; // 收盘后经过时间
  assert.ok(justClosed >= 0 && justClosed <= CANDLE_FRESHNESS_GRACE_MS, '测试时刻须落在宽限期内');
  const lagOne = freshOpen - H4;
  const c = deriveCandleOverviewFreshness(
    { PEPE: freshOpen, DOGE: freshOpen, BTC: freshOpen, ETHFI: lagOne },
    NOW,
  );
  assert.equal(c.perCoin.ETHFI.status, 'LIVE');
  assert.equal(c.status, 'LIVE');
});

test('ETHFI-FRESH6：floorTo4H/expected 口径与三币共用同一 now', () => {
  const c = deriveCandleOverviewFreshness(
    { PEPE: freshOpen, DOGE: freshOpen, BTC: freshOpen, ETHFI: freshOpen },
    NOW,
  );
  assert.equal(c.current4HOpenTs, floorTo4H(NOW));
  assert.equal(c.expectedLastConfirmedOpenTs, freshOpen);
});

/* ---------------- 2) alert ---------------- */

test('ETHFI-ALERT1：默认订阅 ETHFI 与 DOGE 一致（跟踪/回踩/淘汰/数据不足开，观察/过热关）', () => {
  assert.equal(DEFAULT_ALERT_SETTINGS.coins.ETHFI, true);
  assert.equal(DEFAULT_ALERT_SETTINGS.coins.DOGE, true);
  for (const k of Object.keys(DEFAULT_SUBSCRIPTIONS) as (keyof typeof DEFAULT_SUBSCRIPTIONS)[]) {
    assert.equal(DEFAULT_ALERT_SETTINGS.subscriptions[k], DEFAULT_SUBSCRIPTIONS[k]);
  }
});

test('ETHFI-ALERT2：alertKey 格式 symbol+episodeId+action', () => {
  assert.equal(buildAlertKey('ETHFI', 'EP-ETHFI-001', 'BREAKOUT_TRACK'), 'ETHFI|EP-ETHFI-001|BREAKOUT_TRACK');
});

test('ETHFI-ALERT3：状态变化才建 Alert（同 B-TEST3 标准）', () => {
  const base = {
    coin: 'ETHFI' as const,
    episodeId: 'EP-ETHFI-001',
    price: 0.58,
    freshnessLabel: '新鲜',
    subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [] as string[],
    ackedKeys: [] as string[],
  };
  const noChange = shouldCreateAlert({ ...base, prevAction: 'WATCH', curAction: 'WATCH' });
  assert.equal(noChange.create, false);
  const changed = shouldCreateAlert({ ...base, prevAction: 'WATCH', curAction: 'BREAKOUT_TRACK' });
  assert.equal(changed.create, true);
});

test('ETHFI-ALERT4：TEST 隔离（test-episode 禁写真实历史，同标准）', () => {
  const rec: AlertRecord = {
    alertKey: `ETHFI|${TEST_ALERT_EPISODE_ID}|BREAKOUT_TRACK`,
    coin: 'ETHFI',
    episodeId: TEST_ALERT_EPISODE_ID,
    actionCode: 'BREAKOUT_TRACK',
    severity: 'IMPORTANT',
    title: 'ETHFI · 测试报警（不代表真实信号）',
    body: '测试',
    price: 0.58,
    freshnessLabel: '新鲜',
    createdAt: NOW,
    lifecycle: 'ACTIVE',
    darkReason: null,
  };
  assert.equal(isTestAlertKey(rec.alertKey), true);
  assert.deepEqual(pushHistory([], rec), []);
});

test('ETHFI-ALERT5：旧持久化设置（仅 PEPE/DOGE）经 sanitize 补 ETHFI=true', () => {
  const s = sanitizeSettings({ coins: { PEPE: true, DOGE: false } });
  assert.equal(s.coins.ETHFI, true);
  assert.equal(s.coins.DOGE, false);
});

test('ETHFI-ALERT6：文案禁语（买入/胜率/概率类）ETHFI 沿用同一禁令', () => {
  const all = Object.values(ALERT_COPY).map((c) => `${c.title}${c.body}`).join('');
  for (const w of BANNED_COPY_WORDS) assert.ok(!all.includes(w), `文案含禁语：${w}`);
});

/* ---------------- 3) market ---------------- */

test('ETHFI-MARKET1：OKX/Binance symbol 映射（现货+永续同 instId 口径）', () => {
  assert.equal(MARKET_META.OKX_INST.ETHFI, 'ETHFI-USDT-SWAP');
  assert.equal(MARKET_META.BINANCE_SYMBOL.ETHFI, 'ETHFIUSDT');
  assert.equal(ASSETS.ETHFI.instId, 'ETHFI-USDT-SWAP');
  assert.equal(ASSETS.ETHFI.fundingBinanceSymbol, 'ETHFIUSDT');
});

test('ETHFI-MARKET2：精度适配 formatPrice（0.58 量级 → 4 位小数，非科学计数）', () => {
  assert.equal(formatPrice(0.5811), '0.5811');
  assert.equal(formatPrice(0.6039), '0.6039');
  assert.ok(!formatPrice(0.5811).includes('e'));
});

test('ETHFI-MARKET3：无历史研究快照（21 事件无 ETHFI 基线，诚实为空，禁编造）', () => {
  assert.deepEqual(getSnapshotCandles('ETHFI'), []);
  assert.deepEqual(getSnapshotFunding('ETHFI'), []);
});

/* ---------------- 4) B-TEST 同标准 + Quant 审计 ---------------- */

test('ETHFI-ENGINE1：analyzeAssetV2 可跑 ETHFI（合成 120 根已收盘 4H，不抛异常）', () => {
  const bars = mkCandles(120, 0.58);
  const btc = mkCandles(120, 100);
  const sig = analyzeAssetV2('ETHFI', bars, null, btc, [], { peerRelativeStrengthPct: 1.2 });
  assert.equal(sig.asset, 'ETHFI');
  assert.ok(typeof sig.stateLabel === 'string' && sig.stateLabel.length > 0);
  assert.ok(sig.breakout.episodeId == null || sig.breakout.episodeId.startsWith('EP-ETHFI-'));
});

test('ETHFI-QUANT1：策略阈值零改动（Rolling42 等冻结值）', () => {
  assert.equal(DEFAULT_V2_THRESHOLDS.breakoutLookbackCandles, 42);
  assert.equal(DEFAULT_V2_THRESHOLDS.breakoutVolRatioStrong, 2.0);
  assert.equal(DEFAULT_V2_THRESHOLDS.breakoutVolRatioWeak, 1.2);
  assert.equal(DEFAULT_V2_THRESHOLDS.volumePercentileStrong, 90);
  assert.equal(DEFAULT_V2_THRESHOLDS.fundingOverheatPct, 0.03);
  assert.equal(DEFAULT_V2_THRESHOLDS.btcMaxDrawdownPct, -10);
});

test('ETHFI-QUANT2：权重零改动（各层合计 100）', () => {
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum(DEFAULT_V2_WEIGHTS.setup), 100);
  assert.equal(sum(DEFAULT_V2_WEIGHTS.trigger), 100);
  assert.equal(sum(DEFAULT_V2_WEIGHTS.followThrough), 100);
});

test('ETHFI-RESEARCH1：研究空缺确认（ETHFI 无 Precision/Recall/胜率基线，禁编造）', () => {
  // 21 事件快照中无 ETHFI 币种：有据为空缺，非"零值"。
  const pepe = getSnapshotCandles('PEPE');
  const doge = getSnapshotCandles('DOGE');
  const ethfi = getSnapshotCandles('ETHFI');
  assert.ok(pepe.length > 0 && doge.length > 0);
  assert.equal(ethfi.length, 0);
});
