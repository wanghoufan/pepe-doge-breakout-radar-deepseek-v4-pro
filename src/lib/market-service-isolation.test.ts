/**
 * 分标隔离测试（HIGH 修复验收：ETHFI 单点故障不拖垮 PEPE/DOGE）。
 * 只测纯组装 buildMarketOverview（合成抓取结果，无网络/无 UI/无密钥）。
 * 阈值/权重/策略零改动（Quant 审计见 ETHFI-QUANT*，本文件不碰）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketOverview, type MarketFetchResults } from './market-service';
import { ASSETS, BASELINE_COINS, DEFAULT_COIN_SWITCHES, OKX_PERP_LINE, TRADE_COINS } from './config';
import { MARKET_META } from './market-client';
import { expectedLastConfirmedOpenTs } from './time';
import type { Candle } from './types';
import type { FetchDiag } from './market-client';

const H4 = 4 * 3_600_000;
const NOW = Date.parse('2026-09-08T12:00:00Z');
const FRESH_OPEN = expectedLastConfirmedOpenTs(NOW);

function mkDiag(ok: boolean, detail: string | null = null): FetchDiag {
  return {
    url: 'https://www.okx.com/api/v5/market/candles',
    host: 'www.okx.com',
    httpStatus: ok ? 200 : null,
    vendorCode: null,
    vendorMsg: null,
    errorKind: ok ? 'none' : 'network',
    errorDetail: detail,
    cached: false,
    durationMs: 10,
    attempts: [],
  };
}

function mkCandles(n: number, price: number, lastTs: number): Candle[] {
  const ts0 = lastTs - (n - 1) * H4;
  return Array.from({ length: n }, (_, i) => ({
    ts: ts0 + i * H4,
    o: price,
    h: price * 1.01,
    l: price * 0.99,
    c: price * (1 + (i % 5) * 0.001),
    vol: 1000 + i,
    quoteVol: price * (1000 + i),
    confirmed: true,
  }));
}

function candlesOk(price: number, n = 120): MarketFetchResults['btc'] {
  const bars = mkCandles(n, price, FRESH_OPEN);
  return {
    ok: true,
    data: {
      instId: 'TEST-USDT-SWAP',
      bar: '4H',
      candles: bars,
      confirmedCandles: bars,
      intradayCandle: null,
      until: FRESH_OPEN,
      fetchedAt: NOW,
    },
    diag: mkDiag(true),
  };
}

function candlesFail(coin: string): MarketFetchResults['btc'] {
  return { ok: false, error: 'network', diag: mkDiag(false, `DNS 解析失败：${coin} getaddrinfo EAI_AGAIN`) };
}

function tickersOk(): MarketFetchResults['tickers'] {
  return {
    ok: true,
    data: {
      BTC: { last: 67000, ts: NOW - 60_000 },
      PEPE: { last: 0.00001234, ts: NOW - 60_000 },
      DOGE: { last: 0.32, ts: NOW - 60_000 },
      ETHFI: { last: 0.58, ts: NOW - 60_000 },
    },
    diag: mkDiag(true),
  };
}

function fundingOk(symbol: string): MarketFetchResults['pepeFunding'] {
  const points = Array.from({ length: 30 }, (_, i) => ({ ts: NOW - (29 - i) * 8 * H4, rate: 0.0001 }));
  return { ok: true, data: { symbol, points, provider: 'binance' as const }, diag: mkDiag(true) };
}

function fundingFail(): MarketFetchResults['pepeFunding'] {
  return { ok: false, error: 'funding_unavailable', diag: mkDiag(false, 'Binance: network || OKX: network') };
}

function allOk(): MarketFetchResults {
  return {
    btc: candlesOk(67000),
    pepe: candlesOk(0.00001234),
    doge: candlesOk(0.32),
    ethfi: candlesOk(0.58),
    tickers: tickersOk(),
    pepeFunding: fundingOk('1000PEPEUSDT'),
    dogeFunding: fundingOk('DOGEUSDT'),
    ethfiFunding: fundingOk('ETHFIUSDT'),
  };
}

/* ---------------- 隔离验收 ---------------- */

test('ISOL-A1：四方全 LIVE → 全信号 + 全局 live + 分标全 ok', () => {
  const o = buildMarketOverview(allOk(), NOW);
  assert.equal(o.status, 'live');
  assert.ok(o.pepe && o.doge && o.ethfi, '三标信号全有');
  assert.equal(o.btc.source, 'okx');
  assert.equal(o.freshness.status, 'ok');
  assert.equal(o.freshnessByCoin.PEPE.status, 'ok');
  assert.equal(o.freshnessByCoin.DOGE.status, 'ok');
  assert.equal(o.freshnessByCoin.ETHFI.status, 'ok');
  assert.deepEqual(o.errors, []);
});

test('ISOL-A2（核心）：ETHFI K 线失败 → PEPE/DOGE 仍 LIVE，只有 ETHFI 降级', () => {
  const r = allOk();
  r.ethfi = candlesFail('ETHFI');
  const o = buildMarketOverview(r, NOW);
  assert.equal(o.status, 'live');
  assert.ok(o.pepe, 'PEPE 信号仍在');
  assert.ok(o.doge, 'DOGE 信号仍在');
  assert.equal(o.ethfi, null);
  assert.equal(o.btc.source, 'okx');
  assert.equal(o.freshness.status, 'ok');
  assert.equal(o.freshnessByCoin.PEPE.status, 'ok');
  assert.equal(o.freshnessByCoin.DOGE.status, 'ok');
  assert.equal(o.freshnessByCoin.ETHFI.status, 'unavailable');
  assert.ok(o.errors.some((e) => e.includes('ETHFI')), '诊断保留 ETHFI 失败');
});

test('ISOL-A3：ETHFI 已收盘 K 线不足 20 根 → PEPE/DOGE 仍 LIVE', () => {
  const r = allOk();
  r.ethfi = candlesOk(0.58, 10);
  const o = buildMarketOverview(r, NOW);
  assert.equal(o.status, 'live');
  assert.ok(o.pepe && o.doge, 'PEPE/DOGE 信号仍在');
  assert.equal(o.ethfi, null);
  assert.equal(o.freshnessByCoin.ETHFI.status, 'unavailable');
  assert.ok(o.errors.some((e) => e.includes('ETHFI 已收盘 K 线不足 20 根（10）')));
});

test('ISOL-A4：BTC（共享环境依赖）失败 → 全标降级，属预期（非 ETHFI 式拖垮）', () => {
  const r = allOk();
  r.btc = candlesFail('BTC');
  const o = buildMarketOverview(r, NOW);
  assert.equal(o.status, 'unavailable');
  assert.equal(o.pepe, null);
  assert.equal(o.doge, null);
  assert.equal(o.ethfi, null);
  assert.equal(o.freshness.status, 'unavailable');
  assert.equal(o.freshnessByCoin.PEPE.status, 'unavailable');
});

test('ISOL-A5：ETHFI 资金费率失败 → 不阻塞分析（ETHFI 信号仍在，fundingTs 缺省）', () => {
  const r = allOk();
  r.ethfiFunding = fundingFail();
  const o = buildMarketOverview(r, NOW);
  assert.equal(o.status, 'live');
  assert.ok(o.ethfi, 'ETHFI 信号仍在（资金费率不阻塞）');
  assert.equal(o.fundingTs.ETHFI, null);
  assert.ok(o.errors.some((e) => e.includes('ETHFI 资金费率不可用')));
});

/* ---------------- 配置化（同路径不断言数值，只断言单一来源一致） ---------------- */

test('ISOL-C1：market-client 映射与 config.ASSETS 同值（无散落字面量分叉）', () => {
  assert.equal(MARKET_META.OKX_INST.PEPE, ASSETS.PEPE.instId);
  assert.equal(MARKET_META.OKX_INST.DOGE, ASSETS.DOGE.instId);
  assert.equal(MARKET_META.OKX_INST.BTC, ASSETS.BTC.instId);
  assert.equal(MARKET_META.OKX_INST.ETHFI, ASSETS.ETHFI.instId);
  assert.equal(MARKET_META.BINANCE_SYMBOL.PEPE, ASSETS.PEPE.fundingBinanceSymbol);
  assert.equal(MARKET_META.BINANCE_SYMBOL.DOGE, ASSETS.DOGE.fundingBinanceSymbol);
  assert.equal(MARKET_META.BINANCE_SYMBOL.ETHFI, ASSETS.ETHFI.fundingBinanceSymbol);
});

test('ISOL-C2：标的名单/排序/开关/基线/展示行走配置', () => {
  assert.deepEqual([...TRADE_COINS], ['PEPE', 'DOGE', 'ETHFI']);
  assert.deepEqual([...BASELINE_COINS], ['PEPE', 'DOGE']);
  assert.deepEqual(DEFAULT_COIN_SWITCHES, { PEPE: true, DOGE: true, ETHFI: true });
  assert.equal(OKX_PERP_LINE, 'PEPE/DOGE/ETHFI/BTC-USDT-SWAP');
});
