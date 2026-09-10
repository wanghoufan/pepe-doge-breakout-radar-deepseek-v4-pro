/**
 * P0 数据基建测试 A：registry + schema + venue adapter + 去重键口径。
 * 纯函数单测，无网络、无评分（Quant NONE）。
 * 范围冻结：PEPE/DOGE/ETHFI+BTC，okx/binance；禁 Bybit/CoinGlass 常量。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  INSTRUMENT_REGISTRY,
  INSTRUMENT_REGISTRY_VERSION,
  canonicalizePrice,
  lookupInstrument,
} from './research/instrument-registry';
import { ASSETS } from './config';
import { makeRecord, validateRecord } from './research/schema';
import { normalizeBinanceOi, normalizeOkxOi, toPriceTriple } from './research/venue-adapters';
import { buildDedupKey } from './research/ingest';

function awaitRead(p: string): string {
  return readFileSync(join(process.cwd(), p), 'utf8');
}

test('REG-1：registry 覆盖 2所×4标的×现货永续可区分，同串不同 market_type key 不同', () => {
  const perp = lookupInstrument('binance', 'perp', 'PEPE')!;
  const spot = lookupInstrument('binance', 'spot', 'PEPE')!;
  assert.ok(perp && spot, '现货/永续均有注册');
  assert.notEqual(perp.key, spot.key, '同 symbol 字符串必须 key 可区分');
  assert.equal(perp.symbolRaw, spot.symbolRaw, '同串（U 本位同名）');
  assert.equal(perp.version, INSTRUMENT_REGISTRY_VERSION);
  // 全表无出范围所/币
  for (const e of INSTRUMENT_REGISTRY) {
    assert.ok(['okx', 'binance'].includes(e.exchange), `交易所冻结：${e.exchange}`);
    assert.ok(['PEPE', 'DOGE', 'ETHFI', 'BTC'].includes(e.symbolNorm), `标的冻结：${e.symbolNorm}`);
  }
  const text = JSON.stringify(INSTRUMENT_REGISTRY).toLowerCase();
  assert.ok(!text.includes('bybit') && !text.includes('coinglass'), '禁 Bybit/CoinGlass 常量');
});

test('REG-2：1000PEPE 走 registry 归一（adapter 禁手写 1000 常量路径）', () => {
  const e = lookupInstrument('binance', 'perp', 'PEPE')!;
  assert.equal(e.symbolRaw, '1000PEPEUSDT');
  assert.equal(e.unitsPerNative, 1000);
  assert.equal(canonicalizePrice(e, 1000), 1, '1000PEPE 合约价 /1000 得单个 PEPE 可比价');
  const okx = lookupInstrument('okx', 'perp', 'PEPE')!;
  assert.equal(canonicalizePrice(okx, 0.00001234), 0.00001234);
  // adapter 源码禁硬编码 1000 换算（缩放只允许出现在 registry）
  const fs = awaitRead('src/lib/research/venue-adapters.ts');
  assert.ok(!/\*\s*1000|\/\s*1000|0\.001/.test(fs), 'adapter 禁硬编码 multiplier');
});

test('REG-3：registry 与业务配置解耦（不 import config，快照自持；同值由本单测对账）', () => {
  const src = awaitRead('src/lib/research/instrument-registry.ts');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  assert.ok(!/from\s+['"]\.\.\/config['"]/.test(code), '禁 import 业务 config（注释说明除外）');
  assert.ok(!/ASSETS/.test(code), '实现禁运行时读取 ASSETS（注释说明除外）');
  // 同值对账（不同源；漂移即失败，由人工 bump 版本同步，不自动穿透）
  for (const coin of ['PEPE', 'DOGE', 'ETHFI', 'BTC'] as const) {
    assert.equal(lookupInstrument('okx', 'perp', coin)!.symbolRaw, ASSETS[coin].instId, `${coin} OKX 永续同值`);
    assert.equal(lookupInstrument('okx', 'spot', coin)!.symbolRaw, ASSETS[coin].spotInstId, `${coin} OKX 现货同值`);
    const expectedBinance = ASSETS[coin].fundingBinanceSymbol || 'BTCUSDT';
    assert.equal(lookupInstrument('binance', 'perp', coin)!.symbolRaw, expectedBinance, `${coin} Binance 永续同值`);
  }
});

test('SCH-1：makeRecord 自动填版本 + validate 通过；is_backfill 必须配 rest-backfill', () => {
  const r = makeRecord({
    exchange: 'okx',
    symbol_raw: 'PEPE-USDT-SWAP',
    symbol_norm: 'PEPE',
    market_type: 'perp',
    instrument_registry_key: 'OKX-PERP-PEPEUSDTSWAP',
    instrument_registry_version: INSTRUMENT_REGISTRY_VERSION,
    field: 'oi_notional_usd',
    value_raw: 123.45,
    dedup_key: 'okx|OKX-PERP-PEPEUSDTSWAP|oi:1',
  });
  assert.equal(r.schema_version, '1.1.0');
  assert.deepEqual(validateRecord(r), []);
  const bad = { ...r, is_backfill: true, channel: 'ws' as const };
  assert.ok(validateRecord(bad).some((e) => e.includes('rest-backfill')), '回补通道门控');
});

test('SCH-2：source_event_id 无原生 ID 保持 null（OI/funding 禁拿源 ts 冒充）', () => {
  const oi = makeRecord({
    exchange: 'okx',
    symbol_raw: 'PEPE-USDT-SWAP',
    symbol_norm: 'PEPE',
    field: 'oi_notional_usd',
    value_raw: 1,
    dedup_key: buildDedupKey({ kind: 'oi', exchange: 'okx', instrumentRegistryKey: 'K', nativeId: 1788800000000 }),
  });
  assert.equal(oi.source_event_id, null, 'OI source_event_id 保持 null');
  assert.ok(oi.dedup_key.includes('oi:1788800000000'), 'OI 去重用源 ts（仅去重键，不冒充原生 ID）');
  const funding = buildDedupKey({ kind: 'funding', exchange: 'binance', instrumentRegistryKey: 'K', nativeId: 1788800000000 });
  assert.ok(funding.includes('funding:1788800000000'), 'funding 去重用 fundingTime');
  const trade = buildDedupKey({ kind: 'trade', exchange: 'okx', instrumentRegistryKey: 'K', nativeId: '987654321' });
  assert.ok(trade.includes('trade:987654321'), 'trade 去重用原生 tradeId');
});

test('VEN-1：OKX 优先 oiUsd 并保留原生（无 oiUsd 记 null，禁自算通用公式）', () => {
  const r = normalizeOkxOi({ symbolNorm: 'PEPE', oi: '123456', oiCcy: 'PEPE', oiUsd: '987654.32', metadata: { instId: 'PEPE-USDT-SWAP' } });
  assert.equal(r.oi_notional_usd, 987654.32);
  assert.equal(r.oi_native, 123456);
  assert.equal(r.oiCcy, 'PEPE');
  assert.ok(r.instrument_registry_key.length > 0, '绑定 registry key');
  const missing = normalizeOkxOi({ symbolNorm: 'PEPE', oi: '1', oiCcy: 'PEPE', oiUsd: null });
  assert.equal(missing.oi_notional_usd, null, '无官方 oiUsd 禁自算');
});

test('VEN-2：Binance 原生 openInterest 经 registry 转 notional（禁跨所复用 OKX 路径）', () => {
  const mark = toPriceTriple('binance', 'perp', 'PEPE', 12);
  assert.equal(mark.price_canonical, 0.012, '1000PEPE mark 经 registry 归一');
  const r = normalizeBinanceOi({ symbolNorm: 'PEPE', openInterest: '5000', markCanonical: mark.price_canonical });
  // 5000（千PEPE单位）→ 5,000,000 单PEPE × 0.012 = 60000 USD
  assert.equal(r.oi_notional_usd, 60000);
  assert.equal(r.oi_native, 5000, '原生保留');
});
