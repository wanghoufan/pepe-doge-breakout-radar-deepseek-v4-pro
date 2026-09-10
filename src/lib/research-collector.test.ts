/**
 * P0 前向采集器测试（Quant NONE）：
 * 全通道组装（OI/trades/mark/index/funding/depth）+ 双时间戳 + 去重幂等 +
 * 失败异常事件（禁静默）+ 冻结 limitation 诚实标记 + 实时隔离。
 * 纯函数 + mock fetch，无网络、无评分。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COLLECTOR_POLL_MS,
  buildForwardTargets,
  sweepInto,
  sweepOnce,
  type FetchJson,
} from './research/collector';
import { DedupStore } from './research/ingest';
import { validateRecord } from './research/schema';
import { ResearchStore } from './research/store';
import { checkRealtimeIsolation } from './research/isolation';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');
/** 事件时间锚定当前（OKX funding 照实为未来 dating，Binance 为过去结算时刻）。 */
const TS = Date.now();

function okxEnvelope(rows: unknown[]): unknown {
  return { code: '0', msg: '', data: rows };
}

/** fixture：全部通道成功（决定性，便于断言条数与字段）。 */
function mockAllOk(): FetchJson {
  return async (url: string) => {
    if (url.includes('open-interest')) {
      return { status: 200, body: okxEnvelope([{ oi: '1000', oiCcy: 'PEPE', oiUsd: '5000000', ts: String(TS) }]) };
    }
    if (url.includes('/fapi/v1/openInterest')) {
      return { status: 200, body: { openInterest: '2000', time: TS } };
    }
    if (url.includes('/market/trades')) {
      return { status: 200, body: okxEnvelope([{ tradeId: 't-1', px: '0.00001234', sz: '100', side: 'buy', ts: String(TS) }, { tradeId: 't-2', px: '0.00001230', sz: '50', side: 'sell', ts: String(TS) }]) };
    }
    if (url.includes('aggTrades')) {
      return { status: 200, body: [{ a: 11, p: '12', q: '5', T: TS, m: false }, { a: 12, p: '12', q: '3', T: TS, m: true }] };
    }
    if (url.includes('mark-price')) {
      return { status: 200, body: okxEnvelope([{ markPx: '0.00001234', ts: String(TS) }]) };
    }
    if (url.includes('index-tickers')) {
      return { status: 200, body: okxEnvelope([{ idxPx: '0.00001230', ts: String(TS) }]) };
    }
    if (url.includes('premiumIndex')) {
      return { status: 200, body: { markPrice: '12', indexPrice: '11.99', time: TS } };
    }
    if (url.includes('funding-rate') && url.includes('okx.com')) {
      return { status: 200, body: okxEnvelope([{ fundingTime: String(TS + 8 * 3_600_000), realizedRate: '0.0001', fundingRate: '0.0001' }]) };
    }
    if (url.includes('fundingRate')) {
      return { status: 200, body: [{ fundingTime: TS - 8 * 3_600_000, fundingRate: '0.0003' }] };
    }
    if (url.includes('/market/books')) {
      return { status: 200, body: okxEnvelope([{ asks: [['0.00001240', '1000']], bids: [['0.00001234', '2000']], ts: String(TS), seqId: '99' }]) };
    }
    if (url.includes('/fapi/v1/depth')) {
      return { status: 200, body: { lastUpdateId: 77, E: TS, T: TS, bids: [['12', '2']], asks: [['12.01', '1']] } };
    }
    throw new Error(`unexpected url ${url}`);
  };
}

test('FWD-1：目标清单 42 targets（BTC 无 funding；Binance index 复用 mark；禁 Bybit）', () => {
  const targets = buildForwardTargets();
  // 33（交易标的）+ 9（BTC）= 42
  assert.equal(targets.length, 42);
  assert.equal(targets.filter((t) => t.coin === 'BTC' && t.channel === 'funding_current').length, 0, 'BTC 无 funding（基线 N/A）');
  assert.equal(targets.filter((t) => t.exchange === 'binance' && t.channel === 'index').length, 0, 'Binance index 复用 premiumIndex');
  assert.equal(COLLECTOR_POLL_MS, 60_000, 'collector_poll FROZEN 60s');
  const text = JSON.stringify(targets).toLowerCase();
  assert.ok(!text.includes('bybit') && !text.includes('coinglass'));
});

test('FWD-2：全通道冒烟（mock 全成功）：五大家族全有 + 双时间戳 + schema 校验全过', async () => {
  const r = await sweepOnce(mockAllOk());
  assert.deepEqual(r.validationErrors, []);
  assert.equal(r.anomalies.length, 0);
  const fields = new Set(r.records.map((x) => x.field));
  for (const f of ['oi_notional_usd', 'trade', 'mark_price', 'index_price', 'funding_current', 'next_funding_time', 'best_bid', 'best_ask', 'spread_bps', 'depth_bid_0p5', 'depth_ask_0p5']) {
    assert.ok(fields.has(f), `缺通道字段 ${f}`);
  }
  for (const rec of r.records) {
    assert.ok(Number.isFinite(rec.receive_time_ms) && rec.receive_time_ms > 0, 'receive_time 必有');
    assert.deepEqual(validateRecord(rec), []);
    assert.ok(rec.snapshot_id === r.snapshotId, '同 sweep 共享 snapshot_id');
    assert.equal(rec.channel, 'rest');
    assert.equal(rec.is_backfill, false);
  }
  // 事件时间诚实：OKX funding 为未来 dating（F-1 特征如实透传，不改写）。
  const okxFunding = r.records.find((x) => x.exchange === 'okx' && x.field === 'funding_current')!;
  assert.ok((okxFunding.event_time_ms as number) > Date.now(), 'OKX funding 未来 dating 照实透传');
});

test('FWD-3：limitation 诚实标记（D-1 depth unavailable；F-1 OKX funding heartbeat 口径）', async () => {
  const r = await sweepOnce(mockAllOk());
  const depth = r.records.filter((x) => ['best_bid', 'spread_bps'].includes(x.field));
  assert.ok(depth.length > 0);
  for (const d of depth) {
    assert.equal(d.freshness, 'unavailable', 'D-1 UNMAPPED 禁自定映射');
    assert.equal(d.reliability, 'UNAVAILABLE');
    assert.ok(String((d.source_diag['freshnessNote'] as string) ?? '').includes('D-1'), '注明 D-1');
  }
  const okxF = r.records.find((x) => x.exchange === 'okx' && x.field === 'funding_current')!;
  assert.ok(String((okxF.source_diag['datingNote'] as string) ?? '').includes('未来'), '注明未来 dating');
  const binF = r.records.filter((x) => x.exchange === 'binance' && x.field === 'funding_current');
  assert.equal(binF.length, 3);
  for (const b of binF) {
    assert.equal(b.freshness, 'ok', 'Binance funding 走 heartbeat 路径（fundingTime 代入恒误报，禁代入）');
    assert.ok(String((b.source_diag['freshnessReason'] as string) ?? '').includes('heartbeat'), '注明 heartbeat 口径');
  }
});

test('FWD-4：失败建异常事件（禁静默）+ 幂等写入（重复 sweep 禁重复记录）', async () => {
  const failing: FetchJson = async (url: string) => {
    if (url.includes('open-interest') || url.includes('openInterest')) throw new Error('fetch failed');
    return mockAllOk()(url, 8000);
  };
  const r = await sweepOnce(failing);
  assert.ok(r.anomalies.length >= 8, `OI 双所四币全失败应有异常事件，实得 ${r.anomalies.length}`);
  for (const a of r.anomalies) {
    assert.equal(a.field, 'reliability');
    assert.equal(a.value_norm, null, '缺失禁当 0');
    assert.equal(a.reliability, 'UNAVAILABLE');
    assert.ok(a.error_code, '必带错误码');
    assert.deepEqual(validateRecord(a), []);
  }
  // 幂等：同一批写入两次，第二批全判 duplicate。
  const store = new ResearchStore();
  const dedup = new DedupStore();
  const batch = [...r.records, ...r.anomalies];
  const first = sweepInto(store, dedup, batch);
  assert.equal(first.inserted, batch.length);
  const second = sweepInto(store, dedup, batch);
  assert.equal(second.inserted, 0, '重复 sweep 禁产生重复记录');
  assert.equal(store.raw.size, batch.length);
});

test('FWD-5：store 复用 + 派生可跑（derive 不崩；taker/basis 有输入即有输出）', async () => {
  const store = new ResearchStore();
  const dedup = new DedupStore();
  const r = await sweepOnce(mockAllOk());
  sweepInto(store, dedup, [...r.records, ...r.anomalies]);
  const d = store.derive();
  assert.equal(d.rawCount, store.raw.size);
  assert.ok(Object.keys(d.taker).length > 0, 'trade 输入必有 taker 派生');
  assert.ok(Object.keys(d.basisPct).length > 0, 'mark/index 输入必有 basis 派生');
});

test('FWD-6：隔离（实时链路禁消费 collector；collector 禁 import 实时/业务模块）', () => {
  const files: Record<string, string> = {
    'src/lib/market-service.ts': read('src/lib/market-service.ts'),
    'src/lib/v2/engine.ts': read('src/lib/v2/engine.ts'),
    'src/lib/action.ts': read('src/lib/action.ts'),
  };
  assert.deepEqual(checkRealtimeIsolation(files), [], '实时链路零消费新基建（含 collector）');
  const src = read('src/lib/research/collector.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.ok(!/from\s+['"]\.\.\/(config|market-client|market-service|action)['"]/.test(code), 'collector 禁 import 业务/实时模块');
  assert.ok(!/market-client|from '\.\.\/config'/.test(code), 'collector 自持抓取与 registry 快照');
  assert.ok(!/bybit|coinglass/i.test(code), '禁 Bybit/CoinGlass');
  // Quant NONE：禁评分 machinery（权重表/阈值表/胜率计算），"禁..."字面声明本身允许。
  assert.ok(src.includes('Quant NONE'), 'Quant NONE 声明');
  assert.ok(!/DEFAULT_V2_WEIGHTS|DEFAULT_V2_THRESHOLDS|analyzeAssetV2|LayeredScore/.test(code), '禁评分/权重 machinery');
  assert.ok(!/胜率.{0,6}[=：为\d]|权重.{0,6}[=：\d]|收益承诺/.test(code), '禁胜率/权重数值口径');
});
