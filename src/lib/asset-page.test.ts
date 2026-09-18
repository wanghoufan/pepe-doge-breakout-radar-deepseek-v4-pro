/**
 * 详情页动态化验收（纯函数，无网络/无 UI/无密钥）。
 *
 * 覆盖：
 * 1) findEnabledAsset：seed 三币 + 服务端已启用标的可解析；未知 / 未启用 / 参照 → null
 *    （/asset/[coin] 据此 notFound）。
 * 2) HYPE 合成 enabled 走同一详情数据链：buildMarketOverview 产出 signal 非空，
 *    deriveActionState 可推导行动（非 DATA_BLOCKED）；研究基线缺失如实标注。
 * 阈值/权重/状态机零改动（本文件只读不写）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketOverview, type MarketFetchResults, type TickerMap } from './market-service';
import { findEnabledAsset, getSeedRegistry, type RegistryAsset } from './registry';
import { ASSETS } from './config';
import { deriveActionState, actionInputFromSignal } from './action';
import { expectedLastConfirmedOpenTs } from './time';
import type { Candle } from './types';
import type { FetchDiag, FundingResult, OkxCandles, Result } from './market-client';

const H4 = 4 * 3_600_000;
const NOW = Date.parse('2026-09-18T12:00:00Z');
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

type CandlesRes = Result<OkxCandles>;

function candlesOk(instId: string, price: number, n = 120): CandlesRes {
  const bars = mkCandles(n, price, FRESH_OPEN);
  return {
    ok: true,
    data: { instId, bar: '4H', candles: bars, confirmedCandles: bars, intradayCandle: null, until: FRESH_OPEN, fetchedAt: NOW },
    diag: mkDiag(true),
  };
}

function fundingOk(symbol: string): Result<FundingResult> {
  const points = Array.from({ length: 30 }, (_, i) => ({ ts: NOW - (29 - i) * 8 * H4, rate: 0.0001 }));
  return { ok: true, data: { symbol, points, provider: 'binance' as const }, diag: mkDiag(true) };
}

/** 合成 HYPE enabled 注册表记录（来源注册表核验落库，不在内置 ASSETS）。 */
function hypeAsset(): RegistryAsset {
  return {
    id: 'HYPE',
    instId: 'HYPE-USDT-SWAP',
    spotInstId: 'HYPE-USDT',
    name: 'HYPE',
    symbol: 'HYPE',
    role: 'signal',
    status: 'enabled',
    fundingBinanceSymbol: null,
    hasHistoryBaseline: false,
    sortOrder: 20_000,
    themecolor: '#94A3B8',
    verifiedAt: NOW,
    evidence: '测试用合成核验记录',
    source: 'okx',
  };
}

function allOkWithHype(assets: RegistryAsset[]): MarketFetchResults {
  const tickers: TickerMap = {
    BTC: { last: 67000, ts: NOW - 60_000 },
    PEPE: { last: 0.00001234, ts: NOW - 60_000 },
    DOGE: { last: 0.32, ts: NOW - 60_000 },
    ETHFI: { last: 0.58, ts: NOW - 60_000 },
    HYPE: { last: 42.5, ts: NOW - 60_000 },
  };
  return {
    assets,
    candles: {
      BTC: candlesOk('BTC-USDT-SWAP', 67000),
      PEPE: candlesOk('PEPE-USDT-SWAP', 0.00001234),
      DOGE: candlesOk('DOGE-USDT-SWAP', 0.32),
      ETHFI: candlesOk('ETHFI-USDT-SWAP', 0.58),
      HYPE: candlesOk('HYPE-USDT-SWAP', 42.5),
    },
    tickers: { ok: true, data: tickers, diag: mkDiag(true) },
    funding: {
      PEPE: fundingOk('1000PEPEUSDT'),
      DOGE: fundingOk('DOGEUSDT'),
      ETHFI: fundingOk('ETHFIUSDT'),
      HYPE: fundingOk('HYPE-USDT-SWAP'),
    },
  };
}

/* ---------------- 1) 标的解析（页面 VALID / notFound） ---------------- */

test('DETAIL-1：seed 三币可解析，BTC 参照 / 未知标的一律 null（页面 404）', () => {
  const seed = getSeedRegistry();
  for (const id of ['PEPE', 'DOGE', 'ETHFI']) {
    assert.equal(findEnabledAsset(id, seed)?.id, id);
  }
  // BTC 仅环境参照，不是可选信号标的
  assert.equal(findEnabledAsset('BTC', seed), null);
  // 未启用（seed 无 HYPE）→ 未知币
  assert.equal(findEnabledAsset('HYPE', seed), null);
  assert.equal(findEnabledAsset('NOTACOIN', seed), null);
  assert.equal(findEnabledAsset('', seed), null);
});

test('DETAIL-2：HYPE 合成 enabled → 可解析且大小写不敏感，元数据来自注册表', () => {
  const reg = [...getSeedRegistry(), hypeAsset()];
  const hype = findEnabledAsset('hype', reg);
  assert.ok(hype, 'HYPE 已启用 → 详情页可解析（否则 notFound）');
  assert.equal(hype.id, 'HYPE');
  assert.equal(hype.instId, 'HYPE-USDT-SWAP');
  assert.equal(hype.hasHistoryBaseline, false, '无历史基线如实标注，不编造');
  assert.equal(ASSETS.HYPE, undefined, 'HYPE 不在内置 ASSETS → 走注册表 meta + 灰色回退');
});

test('DETAIL-3：candidate 未启用不得进入详情页', () => {
  const candidate: RegistryAsset = {
    ...hypeAsset(),
    status: 'candidate',
    verifiedAt: null,
    evidence: null,
  };
  const reg = [...getSeedRegistry(), candidate];
  assert.equal(findEnabledAsset('HYPE', reg), null);
});

/* ---------------- 2) HYPE 详情数据链（signal → action） ---------------- */

test('DETAIL-4：HYPE 合成 enabled 走详情数据链，signal 非空且 action 可推导', () => {
  const assets = [...getSeedRegistry(), hypeAsset()];
  const o = buildMarketOverview(allOkWithHype(assets), NOW);

  const signal = o.signals.HYPE;
  assert.ok(signal, 'HYPE signal 非空（详情页不再恒缺失）');
  assert.ok(o.prices.HYPE, 'HYPE 现价映射存在');
  assert.equal(o.freshnessByCoin.HYPE.status, 'ok');

  const action = deriveActionState(
    actionInputFromSignal(signal, {
      asset: 'HYPE',
      price: o.prices.HYPE!.last,
      priceTs: o.prices.HYPE!.ts,
      forcedStatus: o.freshnessByCoin.HYPE.status,
      staleReason: o.freshnessByCoin.HYPE.reason,
    }),
  );
  assert.equal(typeof action.code, 'string');
  assert.notEqual(action.code, 'DATA_BLOCKED', '数据 ok 时应给出可推导行动');
  assert.ok(action.title.length > 0);
  // 红线：当前行动不出现胜率/收益承诺类表述
  const text = `${action.summary}${action.warnings.join('')}`;
  for (const banned of ['胜率', '准确率', '概率']) {
    assert.ok(!text.includes(banned), `行动文案含禁语：${banned}`);
  }
});
