/**
 * 前向采集冒烟（mock 通道 + 隔离复核，不碰网络、不碰探针、不碰实时链）：
 *   npx tsx research/forward-collect/smoke.ts
 * 真实单轮验证另用：npx tsx research/forward-collect/collect.ts --once
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildForwardTargets, sweepInto, sweepOnce, type FetchJson } from '../../src/lib/research/collector';
import { DedupStore } from '../../src/lib/research/ingest';
import { validateRecord } from '../../src/lib/research/schema';
import { ResearchStore } from '../../src/lib/research/store';
import { checkRealtimeIsolation } from '../../src/lib/research/isolation';

const TS = 1_786_000_000_000;
const okxEnvelope = (rows: unknown[]): unknown => ({ code: '0', msg: '', data: rows });

function mockAllOk(): FetchJson {
  return async (url: string) => {
    if (url.includes('open-interest')) return { status: 200, body: okxEnvelope([{ oi: '1000', oiCcy: 'PEPE', oiUsd: '5000000', ts: String(TS) }]) };
    if (url.includes('/fapi/v1/openInterest')) return { status: 200, body: { openInterest: '2000', time: TS } };
    if (url.includes('/market/trades')) return { status: 200, body: okxEnvelope([{ tradeId: 't-1', px: '0.00001234', sz: '100', side: 'buy', ts: String(TS) }]) };
    if (url.includes('aggTrades')) return { status: 200, body: [{ a: 11, p: '12', q: '5', T: TS, m: false }] };
    if (url.includes('mark-price')) return { status: 200, body: okxEnvelope([{ markPx: '0.00001234', ts: String(TS) }]) };
    if (url.includes('index-tickers')) return { status: 200, body: okxEnvelope([{ idxPx: '0.00001230', ts: String(TS) }]) };
    if (url.includes('premiumIndex')) return { status: 200, body: { markPrice: '12', indexPrice: '11.99', time: TS } };
    if (url.includes('funding-rate') && url.includes('okx.com')) return { status: 200, body: okxEnvelope([{ fundingTime: String(TS + 8 * 3_600_000), realizedRate: '0.0001', fundingRate: '0.0001' }]) };
    if (url.includes('fundingRate')) return { status: 200, body: [{ fundingTime: TS - 8 * 3_600_000, fundingRate: '0.0003' }] };
    if (url.includes('/market/books')) return { status: 200, body: okxEnvelope([{ asks: [['0.00001240', '1000']], bids: [['0.00001234', '2000']], ts: String(TS), seqId: '99' }]) };
    if (url.includes('/fapi/v1/depth')) return { status: 200, body: { lastUpdateId: 77, E: TS, T: TS, bids: [['12', '2']], asks: [['12.01', '1']] } };
    throw new Error(`unexpected url ${url}`);
  };
}

async function main(): Promise<void> {
  const checks: [string, boolean][] = [];
  const targets = buildForwardTargets();
  checks.push(['目标 42 targets（BTC 无 funding）', targets.length === 42 && targets.filter((t) => t.coin === 'BTC' && t.channel === 'funding_current').length === 0]);
  const r = await sweepOnce(mockAllOk());
  const fields = new Set(r.records.map((x) => x.field));
  const need = ['oi_notional_usd', 'trade', 'mark_price', 'index_price', 'funding_current', 'next_funding_time', 'best_bid', 'best_ask', 'spread_bps', 'depth_bid_0p5', 'depth_ask_0p5'];
  checks.push(['五大家族全通道有记录', need.every((f) => fields.has(f))]);
  checks.push(['异常事件零（mock 全成功）', r.anomalies.length === 0]);
  checks.push(['schema 校验全过', r.validationErrors.length === 0 && [...r.records, ...r.anomalies].every((x) => validateRecord(x).length === 0)]);
  checks.push(['双时间戳齐全', r.records.every((x) => Number.isFinite(x.receive_time_ms))]);
  checks.push(['同 sweep 共享 snapshot_id', r.records.every((x) => x.snapshot_id === r.snapshotId)]);
  const store = new ResearchStore();
  const dedup = new DedupStore();
  const w1 = sweepInto(store, dedup, [...r.records, ...r.anomalies]);
  const w2 = sweepInto(store, dedup, [...r.records, ...r.anomalies]);
  checks.push([`幂等写入（inserted=${w1.inserted}，重放零插入）`, w1.inserted === r.records.length + r.anomalies.length && w2.inserted === 0]);
  const d = store.derive();
  checks.push(['derive 可跑（taker/basis 有输出）', d.rawCount === store.raw.size && Object.keys(d.taker).length > 0 && Object.keys(d.basisPct).length > 0]);
  const failing: FetchJson = async (url: string) => {
    if (url.includes('open-interest') || url.includes('openInterest')) throw new Error('fetch failed');
    return mockAllOk()(url, 8000);
  };
  const rf = await sweepOnce(failing);
  checks.push([`失败建异常事件（${rf.anomalies.length} 起，禁静默）`, rf.anomalies.length >= 8 && rf.anomalies.every((a) => a.field === 'reliability' && a.value_norm === null && a.error_code !== null)]);
  const files: Record<string, string> = {
    'src/lib/market-service.ts': readFileSync(join(process.cwd(), 'src/lib/market-service.ts'), 'utf8'),
    'src/lib/v2/engine.ts': readFileSync(join(process.cwd(), 'src/lib/v2/engine.ts'), 'utf8'),
    'src/lib/action.ts': readFileSync(join(process.cwd(), 'src/lib/action.ts'), 'utf8'),
  };
  checks.push(['实时隔离保持', checkRealtimeIsolation(files).length === 0]);
  let fail = 0;
  for (const [name, ok] of checks) {
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
    if (!ok) fail += 1;
  }
  console.log(`[smoke] records=${r.records.length} anomalies=${r.anomalies.length} store=${store.raw.size}`);
  console.log('[smoke] 覆盖率变化：0% → 0%（冒烟只建通道，本次不管覆盖数字；eligible 仍为空，评测不可启动）');
  if (fail) {
    console.error(`[smoke] FAILED ${fail} 项`);
    process.exit(1);
  }
  console.log('[smoke] ALL PASS');
}

main().catch((e) => {
  console.error('[smoke] fatal', e);
  process.exit(1);
});
