/**
 * 逐币核验启用门测试（无网络：依赖全部注入假数据）。
 * 覆盖：全过 / 单项失败 / 未知标的 / 精度缺失 / K 线过短 / 限频 / 记录持久化与启用。
 * 不碰 indicators / 阈值权重 / 状态机。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mapVerifyOutcomeToHttp,
  unknownAssetOutcome,
  verifyAsset,
  verifyAssetById,
  type VerificationDeps,
  type VerificationOutcome,
} from './asset-verification';
import { applyVerifications, findAsset, getSeedRegistry, type RegistryAsset, type VerificationCheck } from './registry';
import { openDatabaseAt } from './server/sqlite';
import { getVerification, readVerifications, saveVerification } from './server/asset-verification-repository';
import type { FetchDiag, FundingResult, OkxCandles, OkxSwapInstrument, OkxTickersByInst } from './market-client';
import type { Candle } from './types';

const H4 = 4 * 3_600_000;

function diag(errorKind: FetchDiag['errorKind'] = 'none', errorDetail: string | null = null, httpStatus: number | null = null): FetchDiag {
  const ok = errorKind === 'none';
  return {
    url: 'https://www.okx.com/x',
    host: 'www.okx.com',
    httpStatus: ok ? 200 : httpStatus,
    vendorCode: null,
    vendorMsg: null,
    errorKind,
    errorDetail,
    cached: false,
    durationMs: 1,
    attempts: ok
      ? []
      : [{ url: 'https://www.okx.com/x', errorKind, httpStatus, vendorCode: null, detail: errorDetail }],
  };
}

function makeCandles(n: number): Candle[] {
  // 末根对齐当前 4H（时间戳/收盘语义核验要求非未来且 4H 对齐）。
  const nowAligned = Math.floor(Date.now() / H4) * H4;
  const base = nowAligned - (n - 1) * H4;
  return Array.from({ length: n }, (_, i) => ({
    ts: base + i * H4,
    o: 1,
    h: 1.1,
    l: 0.9,
    c: 1.05,
    vol: 100 + i,
    quoteVol: 105 + i,
    confirmed: true,
  }));
}

function candlesResult(n: number): { ok: true; data: OkxCandles; diag: FetchDiag } {
  const bars = makeCandles(n);
  return {
    ok: true,
    data: {
      instId: 'HYPE-USDT-SWAP',
      bar: '4H',
      candles: bars,
      confirmedCandles: bars,
      intradayCandle: null,
      until: bars.at(-1)!.ts,
      fetchedAt: Date.now(),
    },
    diag: diag(),
  };
}

function instrument(over: Partial<OkxSwapInstrument> = {}): OkxSwapInstrument {
  return {
    instId: 'HYPE-USDT-SWAP',
    state: 'live',
    ctVal: '1',
    ctValCcy: 'HYPE',
    listTime: 1,
    tickSz: '0.001',
    lotSz: '0.1',
    minSz: '0.1',
    ...over,
  };
}

function makeDeps(over: Partial<VerificationDeps> = {}): VerificationDeps {
  return {
    fetchInstruments: async () => ({ ok: true, data: [instrument()], diag: diag() }),
    fetchCandles: async () => candlesResult(120),
    fetchTicker: async () => ({
      ok: true,
      data: { 'HYPE-USDT-SWAP': { last: 42.5, ts: 1 } } as OkxTickersByInst,
      diag: diag(),
    }),
    fetchFunding: async () => ({
      ok: true,
      data: { symbol: 'HYPE-USDT-SWAP', points: [{ ts: 1, rate: 0 }], provider: 'okx' } as FundingResult,
      diag: diag(),
    }),
    minConfirmedCandles: 43,
    ...over,
  };
}

function candidate(id = 'HYPE', instId = 'HYPE-USDT-SWAP'): RegistryAsset {
  return {
    id,
    instId,
    spotInstId: instId.replace('-SWAP', ''),
    name: id,
    symbol: id,
    role: 'signal',
    status: 'candidate',
    fundingBinanceSymbol: null,
    hasHistoryBaseline: false,
    sortOrder: 10_000,
    themecolor: '#94A3B8',
    verifiedAt: null,
    evidence: null,
    source: 'okx',
  };
}

test('核验：全过 → ok=true 且 9 项均通过', async () => {
  const outcome = await verifyAsset(candidate(), makeDeps());
  assert.equal(outcome.ok, true);
  assert.equal(outcome.checks.length, 9);
  assert.deepEqual(outcome.checks.filter((c) => !c.ok), []);
});

test('核验：单项失败（资金费率）→ ok=false 且仅该项失败，原因写清', async () => {
  const deps = makeDeps({
    fetchFunding: async () => ({ ok: false, error: 'funding_unavailable', diag: diag('network', '两条链路均不可用') }),
  });
  const outcome = await verifyAsset(candidate(), deps);
  assert.equal(outcome.ok, false);
  assert.deepEqual(outcome.checks.filter((c) => !c.ok).map((c) => c.key), ['funding']);
  assert.match(outcome.checks.find((c) => c.key === 'funding')?.detail ?? '', /资金费率不可用/);
});

test('核验：未知标的 → 不启用并给出登记失败项', async () => {
  const { asset, outcome } = await verifyAssetById('NOPE', [candidate()], makeDeps());
  assert.equal(asset, null);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.checks.length, 1);
  assert.equal(outcome.checks[0]!.key, 'resolve');
  assert.match(outcome.checks[0]!.detail, /未知标的 NOPE/);
});

test('核验：精度字段缺失 → precision 失败', async () => {
  const deps = makeDeps({
    fetchInstruments: async () => ({ ok: true, data: [instrument({ tickSz: null, lotSz: null })], diag: diag() }),
  });
  const outcome = await verifyAsset(candidate(), deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.checks.find((c) => c.key === 'precision')?.ok, false);
});

test('核验：4H K 线长度不足 → candles 失败', async () => {
  const deps = makeDeps({ fetchCandles: async () => candlesResult(20) });
  const outcome = await verifyAsset(candidate(), deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.checks.find((c) => c.key === 'candles')?.ok, false);
});

test('核验：命中 429 限频 → rateLimit 失败', async () => {
  const deps = makeDeps({
    fetchTicker: async () => ({ ok: false, error: 'okx_ticker_failed', diag: diag('http_status', 'HTTP 429', 429) }),
  });
  const outcome = await verifyAsset(candidate(), deps);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.checks.find((c) => c.key === 'rateLimit')?.ok, false);
});

test('核验记录：持久化 + 启用（含目录缺席时凭记录再水化）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-verify-'));
  const db = openDatabaseAt(join(dir, 'verify.db'));
  try {
    saveVerification(db, {
      assetId: 'HYPE',
      instrument: 'HYPE-USDT-SWAP',
      ok: true,
      checks: [{ key: 'instrument', label: 'Instrument 存续与类型', ok: true, detail: 'ok' }],
      verifiedAt: 123,
      by: 'test',
    });
    const records = readVerifications(db);
    assert.equal(records.length, 1);
    assert.equal(getVerification(db, 'HYPE')?.instrument, 'HYPE-USDT-SWAP');

    // 已有候选记录 → 置为 enabled。
    const withCandidate = applyVerifications([candidate()], records);
    assert.equal(findAsset('HYPE', withCandidate)?.status, 'enabled');
    assert.equal(findAsset('HYPE', withCandidate)?.verifiedAt, 123);

    // OKX 目录缺席（注册表无该标的）→ 凭记录再水化，仍 enabled。
    const rehydrated = applyVerifications(getSeedRegistry(), records);
    const hype = findAsset('HYPE', rehydrated);
    assert.equal(hype?.status, 'enabled');
    assert.equal(hype?.source, 'okx');
    assert.equal(hype?.hasHistoryBaseline, false);

    // 未通过记录不得启用。
    const failed = applyVerifications(
      [candidate('XMR', 'XMR-USDT-SWAP')],
      [{ assetId: 'XMR', instrument: 'XMR-USDT-SWAP', ok: false, checks: [], verifiedAt: 1, by: 't' }],
    );
    assert.equal(findAsset('XMR', failed)?.status, 'candidate');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

function allPassOutcome(assetId = 'HYPE'): VerificationOutcome {
  const checks: VerificationCheck[] = [
    { key: 'instrument', label: 'Instrument 存续与类型', ok: true, detail: 'ok' },
    { key: 'funding', label: '资金费率可用性', ok: true, detail: 'okx 可用，30 条' },
  ];
  return { assetId, instrument: `${assetId}-USDT-SWAP`, ok: true, checks };
}

test('route 映射：未知标的 → 422，checks 非空且为 resolve 失败项', () => {
  const res = mapVerifyOutcomeToHttp(unknownAssetOutcome('NOPE'), false, false);
  assert.equal(res.status, 422);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.checks.length > 0);
  assert.equal(res.body.checks[0]!.key, 'resolve');
  assert.match(res.body.message, /未知标的 NOPE/);
});

test('route 映射：核验未过 → 422，写清首个失败项且形状完整', () => {
  const outcome: VerificationOutcome = {
    assetId: 'HYPE',
    instrument: 'HYPE-USDT-SWAP',
    ok: false,
    checks: [
      { key: 'instrument', label: 'Instrument 存续与类型', ok: true, detail: 'ok' },
      { key: 'funding', label: '资金费率可用性', ok: false, detail: '资金费率不可用：两条链路均不可用' },
      { key: 'rateLimit', label: '限频响应', ok: false, detail: '核验期间遇到 HTTP 429 限频' },
    ],
  };
  const res = mapVerifyOutcomeToHttp(outcome, true, false);
  assert.equal(res.status, 422);
  assert.equal(res.body.ok, false);
  assert.ok(res.body.checks.length > 0);
  assert.match(res.body.message, /资金费率可用性 — 资金费率不可用/);
  assert.match(res.body.message, /未启用/);
  for (const c of res.body.checks) {
    assert.equal(typeof c.key, 'string');
    assert.equal(typeof c.label, 'string');
    assert.equal(typeof c.ok, 'boolean');
    assert.equal(typeof c.detail, 'string');
  }
});

test('route 映射：db null → 503，全过也不启用', () => {
  const res = mapVerifyOutcomeToHttp(allPassOutcome(), true, true);
  assert.equal(res.status, 503);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.enabled, undefined);
  assert.ok(res.body.checks.length > 0);
  assert.match(res.body.message, /持久化当前不可用/);
});

test('route 映射：全过 → 200 且 enabled', () => {
  const res = mapVerifyOutcomeToHttp(allPassOutcome(), true, false);
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.enabled, true);
  assert.ok(res.body.checks.length > 0);
  assert.ok(res.body.checks.every((c) => c.ok));
});

test('核验合并：seed 三币仍启用，ETHFI 保持无基线，空记录不改状态', () => {
  const applied = applyVerifications(getSeedRegistry(), []);
  assert.deepEqual(
    applied.filter((a) => a.status === 'enabled').map((a) => a.id),
    ['PEPE', 'DOGE', 'ETHFI'],
  );
  assert.equal(findAsset('ETHFI', applied)?.hasHistoryBaseline, false);
  // 幂等：重复合并不产生重复项。
  const twice = applyVerifications(applied, []);
  assert.equal(twice.length, applied.length);
});
