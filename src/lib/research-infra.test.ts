/**
 * P0 数据基建测试 B：分字段 freshness + 正交双状态 + 幂等回补 + 原始/派生分离 + Action 隔离。
 * 纯函数单测，无网络、无评分（Quant NONE）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIELD_FRESHNESS_POLICY,
  assessFieldFreshness,
  freshnessToReliability,
  priceDiffBps,
  updateCrossMarket,
  type CrossMarketState,
} from './research/field-freshness';
import { DedupStore, buildDedupKey, detectSequenceGap, ingestBatch, markBackfill } from './research/ingest';
import {
  RawStore,
  ResearchStore,
  aggregateTaker,
  computeBasisPct,
  computeFundingCrossDiffPp,
  computeOiChange,
  rollupTaker,
} from './research/store';
import { makeRecord } from './research/schema';
import { INSTRUMENT_REGISTRY_VERSION } from './research/instrument-registry';
import { checkRealtimeIsolation } from './research/isolation';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

test('FRE-1：policy 表驱动（7 行分字段独立；funding current/history 基准不同）', () => {
  const keys = Object.keys(FIELD_FRESHNESS_POLICY).sort();
  assert.deepEqual(keys, ['depth', 'funding_current', 'funding_history', 'index', 'mark', 'oi', 'trades']);
  assert.notEqual(
    FIELD_FRESHNESS_POLICY.funding_current.cadenceKey,
    FIELD_FRESHNESS_POLICY.funding_history.cadenceKey,
    'current=采集 cadence，history=settlement，禁混用',
  );
  assert.ok(FIELD_FRESHNESS_POLICY.trades.cadenceKey.includes('禁用于 stale 判定'), 'cadence_trade 禁入 stale 判定');
});

test('FRE-2：分字段独立判定（2×stale / 4×unavailable；cadence 未冻结禁猜值）', () => {
  const cad = 60_000;
  assert.equal(assessFieldFreshness({ field: 'oi', eventAgeMs: 60_000, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: cad }).freshness, 'ok');
  assert.equal(assessFieldFreshness({ field: 'oi', eventAgeMs: 2 * cad + 1, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: cad }).freshness, 'stale');
  assert.equal(assessFieldFreshness({ field: 'oi', eventAgeMs: 4 * cad + 1, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: cad }).freshness, 'unavailable');
  const frozen = assessFieldFreshness({ field: 'mark', eventAgeMs: 1_000, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: null });
  assert.equal(frozen.freshness, 'unavailable', '基线未冻结禁判定');
  // OI stale 不污染 mark（各自独立调用）
  const mark = assessFieldFreshness({ field: 'mark', eventAgeMs: 10_000, transportAlive: true, heartbeatExpired: false, resolvedCadenceMs: cad });
  assert.equal(mark.freshness, 'ok');
});

test('FRE-3：Trade Transport/Event 正交（存活无成交仍 HEALTHY；断线才降级）', () => {
  const aliveNoTrade = assessFieldFreshness({
    field: 'trades',
    eventAgeMs: 36_000_000,
    transportAlive: true,
    heartbeatExpired: false,
    resolvedCadenceMs: 60_000,
  });
  assert.equal(aliveNoTrade.freshness, 'ok', 'transport 存活禁以 Market Event Age 判 stale');
  assert.equal(freshnessToReliability(aliveNoTrade.freshness), 'HEALTHY');
  const dead = assessFieldFreshness({ field: 'trades', eventAgeMs: 1_000, transportAlive: false, heartbeatExpired: true, resolvedCadenceMs: 60_000, backfillFailed: true });
  assert.equal(dead.freshness, 'unavailable', '断线+回补失败');
});

test('REL-1：freshness→Reliability 映射 + 价差禁降级 reliability（正交）', () => {
  assert.equal(freshnessToReliability('ok'), 'HEALTHY');
  assert.equal(freshnessToReliability('stale'), 'DEGRADED');
  assert.equal(freshnessToReliability('unavailable'), 'UNAVAILABLE');
  // 收紧：作用域限定到映射函数体（禁全文件宽松正则、禁“删注释”式预处理，
  // 旧口径用 /禁[^;]* / 预处理会误删代码导致假通过）；
  // 价差 helper 必须独立存在（跨市场路径专用）但禁进入映射体。
  const src = read('src/lib/research/field-freshness.ts');
  const m = src.match(/export function freshnessToReliability\([\s\S]*?\n\}/);
  assert.ok(m, '映射函数可定位');
  assert.ok(!/diff|price|cross|funding|basis|premium/i.test(m[0]), '映射体禁引用价差/跨市场/资金费率/基差');
  assert.ok(src.includes('export function priceDiffBps'), '价差 helper 保持独立（跨市场路径专用）');
  assert.ok(src.includes('export function updateCrossMarket'), '跨市场确认路径保持独立');
});

test('XMK-1：跨市场 50bps 候选 + 连续 2 周期确认；单源非健康记 null', () => {
  let s: CrossMarketState = { status: 'ALIGNED', consecutiveHits: 0 };
  s = updateCrossMarket(s, 49, true);
  assert.deepEqual(s, { status: 'ALIGNED', consecutiveHits: 0 }, '50bps 以下非候选');
  s = updateCrossMarket(s, 60, true);
  assert.deepEqual(s, { status: 'ALIGNED', consecutiveHits: 1 }, '单周期命中只记候选不翻转');
  s = updateCrossMarket(s, 60, true);
  assert.deepEqual(s, { status: 'DIVERGED', consecutiveHits: 2 }, '连续 2 周期确认');
  const nullCase = updateCrossMarket(s, 9999, false);
  assert.equal(nullCase.status, null, '任一源非 HEALTHY 记 null');
  assert.equal(priceDiffBps(100, 100), 0);
  assert.equal(priceDiffBps(null, 100), null, '缺失记 null');
});

test('ING-1：幂等写入（WS 与 REST 回补同语义；重复禁入）', () => {
  const store = new DedupStore();
  const key = buildDedupKey({ kind: 'trade', exchange: 'okx', instrumentRegistryKey: 'K', nativeId: '1' });
  const mk = (snapshot: string) =>
    makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'trade', value_raw: 1, dedup_key: key, snapshot_id: snapshot });
  const first = ingestBatch(store, [mk('snap-1')]);
  assert.equal(first.inserted.length, 1);
  const retry = ingestBatch(store, [mk('snap-1')]);
  assert.equal(retry.inserted.length, 0);
  assert.equal(retry.duplicates.length, 1, '幂等重试不产生重复');
});

test('ING-2：序列缺口检测 + REST 回补沿用 snapshot_id', () => {
  assert.deepEqual(detectSequenceGap(null, 100), { gap: false, missing: [], duplicateOrReorder: false });
  assert.equal(detectSequenceGap(10, 11).gap, false);
  const g = detectSequenceGap(10, 13);
  assert.equal(g.gap, true);
  assert.deepEqual(g.missing, [11, 12]);
  assert.equal(detectSequenceGap(10, 10).duplicateOrReorder, true);
  const rec = makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'trade', value_raw: 1, dedup_key: 'k', snapshot_id: 'snap-9' });
  const [backfilled] = markBackfill([rec], 'snap-9');
  assert.equal(backfilled.is_backfill, true);
  assert.equal(backfilled.channel, 'rest-backfill');
  assert.equal(backfilled.snapshot_id, 'snap-9', '回补沿用原 snapshot_id');
});

test('STO-1：原始/派生分离（派生可重算；分母 0/缺失记 null）', () => {
  assert.deepEqual(computeOiChange(110, 100), { chgPct: 10, chgUsd: 10 });
  assert.equal(computeOiChange(110, 0).chgPct, null, '分母 0 记 null');
  assert.equal(computeOiChange(null, 100).chgPct, null, '缺失记 null');
  const agg = aggregateTaker([
    { side: 'buy', qtyCanonical: 10, priceCanonical: 2 },
    { side: 'sell', qtyCanonical: 5, priceCanonical: 2 },
  ]);
  assert.equal(agg.cvdProxy, 10);
  assert.equal(agg.bsRatio, 2);
  assert.equal(aggregateTaker([]).bsRatio, null, 'sell=0 记 null');
  const rolled = rollupTaker([agg, agg]);
  assert.equal(rolled.cvdProxy, 20, '上卷一致、可重算');
  assert.equal(computeBasisPct(101, 100), 1);
  assert.ok(Math.abs(computeFundingCrossDiffPp(0.0001, 0.0003)! - -0.02) < 1e-12);
  assert.equal(computeFundingCrossDiffPp(null, 0.0003), null, '单源禁冒充差值');
  // store 级：同 raw 两次 derive 一致，raw 不被改写
  const store = new ResearchStore();
  store.raw.append(
    makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'oi_notional_usd', value_raw: 100, value_norm: 100, event_time_ms: 1000, instrument_registry_key: 'K1', instrument_registry_version: '1.0.0', dedup_key: 'a' }),
  );
  store.raw.append(
    makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'oi_notional_usd', value_raw: 110, value_norm: 110, event_time_ms: 2000, instrument_registry_key: 'K1', instrument_registry_version: '1.0.0', dedup_key: 'b' }),
  );
  const d1 = store.derive();
  const d2 = store.derive();
  assert.equal(d1.oiChange.K1.chgPct, 10);
  assert.deepEqual(d1.oiChange, d2.oiChange, '派生可重算幂等');
  assert.equal(store.raw.size, 2, 'raw 不被派生改写');
  const raw = new RawStore();
  assert.equal(raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'x', symbol_norm: 'PEPE', field: 'trade', value_raw: 1, dedup_key: 'dup' })), true);
  assert.equal(raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'x', symbol_norm: 'PEPE', field: 'trade', value_raw: 1, dedup_key: 'dup' })), false, 'raw 按 dedup_key 幂等');
});

test('STO-2：derive 接通 taker/basis/funding（有输入必有输出；缺输入诚实缺失禁当 0）', () => {
  const V = INSTRUMENT_REGISTRY_VERSION;
  const store = new ResearchStore();
  // taker：K-T1 buy 10@2 + sell 5@2（另附一条缺 side 的无效 tick，应被跳过）
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'trade', value_raw: 20, event_time_ms: 1000, instrument_registry_key: 'K-T1', instrument_registry_version: V, dedup_key: 't1', source_diag: { side: 'buy', qtyCanonical: 10, priceCanonical: 2 } }));
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'trade', value_raw: 10, event_time_ms: 1001, instrument_registry_key: 'K-T1', instrument_registry_version: V, dedup_key: 't2', source_diag: { side: 'sell', qtyCanonical: 5, priceCanonical: 2 } }));
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'trade', value_raw: 14, event_time_ms: 1002, instrument_registry_key: 'K-T1', instrument_registry_version: V, dedup_key: 't3', source_diag: { qtyCanonical: 7, priceCanonical: 2 } }));
  // K-TBAD 全无效 tick（方向非法）→ 该 key 诚实缺席
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'trade', value_raw: 1, event_time_ms: 1003, instrument_registry_key: 'K-TBAD', instrument_registry_version: V, dedup_key: 't4', source_diag: { side: 'hold', qtyCanonical: 1, priceCanonical: 1 } }));
  // basis：K-B1 mark 101 / index 100 → 1；K-BPART 只有 mark → null
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'mark_price', value_raw: 101, value_norm: 101, event_time_ms: 1000, instrument_registry_key: 'K-B1', instrument_registry_version: V, dedup_key: 'm1' }));
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'index_price', value_raw: 100, value_norm: 100, event_time_ms: 1000, instrument_registry_key: 'K-B1', instrument_registry_version: V, dedup_key: 'i1' }));
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'mark_price', value_raw: 105, value_norm: 105, event_time_ms: 1000, instrument_registry_key: 'K-BPART', instrument_registry_version: V, dedup_key: 'm2' }));
  // funding：PEPE 双源 → -0.02；DOGE 仅 okx 单源 → null
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'PEPE-USDT-SWAP', symbol_norm: 'PEPE', field: 'funding_current', value_raw: 0.0001, value_norm: 0.0001, event_time_ms: 1000, instrument_registry_key: 'K-FO', instrument_registry_version: V, dedup_key: 'f1' }));
  store.raw.append(makeRecord({ exchange: 'binance', symbol_raw: '1000PEPEUSDT', symbol_norm: 'PEPE', field: 'funding_current', value_raw: 0.0003, value_norm: 0.0003, event_time_ms: 1000, instrument_registry_key: 'K-FB', instrument_registry_version: V, dedup_key: 'f2' }));
  store.raw.append(makeRecord({ exchange: 'okx', symbol_raw: 'DOGE-USDT-SWAP', symbol_norm: 'DOGE', field: 'funding_current', value_raw: 0.0002, value_norm: 0.0002, event_time_ms: 1000, instrument_registry_key: 'K-FD', instrument_registry_version: V, dedup_key: 'f3' }));
  const d = store.derive();
  // taker：有输入必有派生输出（含无效 tick 跳过后的精确值）
  assert.ok(d.taker['K-T1'], 'trade 输入必有 taker 派生');
  assert.equal(d.taker['K-T1'].buyNotional, 20);
  assert.equal(d.taker['K-T1'].sellNotional, 10);
  assert.equal(d.taker['K-T1'].bsRatio, 2);
  assert.equal(d.taker['K-T1'].cvdProxy, 10);
  assert.ok(!('K-TBAD' in d.taker), '全无效 tick 的 key 诚实缺席（禁零聚合冒充）');
  // basis：有输入必有派生；单边缺失记 null（禁当 0）；无记录的 key 不出条目
  assert.equal(d.basisPct['K-B1'], 1);
  assert.equal(d.basisPct['K-BPART'], null, '单边缺失记 null（禁当 0）');
  assert.ok(!('K-NONE' in d.basisPct), '无记录的 key 不出条目');
  // funding：双源必有差值；单源记 null（禁冒充）；无记录的标的不出条目
  assert.ok(Math.abs(d.fundingCrossDiffPp['PEPE']! - -0.02) < 1e-12, '双源差值 (0.0001-0.0003)*100');
  assert.equal(d.fundingCrossDiffPp['DOGE'], null, '单源禁冒充差值');
  assert.ok(!('ETHFI' in d.fundingCrossDiffPp), '无记录的标的不出条目');
  // 空 store：三类派生全空（诚实缺失，禁出 0）
  const empty = new ResearchStore().derive();
  assert.deepEqual(empty.taker, {});
  assert.deepEqual(empty.basisPct, {});
  assert.deepEqual(empty.fundingCrossDiffPp, {});
  // 派生可重算幂等（三类全比）
  const d2 = store.derive();
  assert.deepEqual(d.taker, d2.taker, 'taker 派生幂等');
  assert.deepEqual(d.basisPct, d2.basisPct, 'basis 派生幂等');
  assert.deepEqual(d.fundingCrossDiffPp, d2.fundingCrossDiffPp, 'funding 派生幂等');
  assert.equal(store.raw.size, 10, 'raw 不被派生改写');
});

test('ISO-1：实时 Action 禁消费新字段（三文件零 import + 零字段名）', () => {
  const files: Record<string, string> = {
    'src/lib/market-service.ts': read('src/lib/market-service.ts'),
    'src/lib/v2/engine.ts': read('src/lib/v2/engine.ts'),
    'src/lib/action.ts': read('src/lib/action.ts'),
  };
  assert.deepEqual(checkRealtimeIsolation(files), [], '实时链路必须零消费新基建');
});
