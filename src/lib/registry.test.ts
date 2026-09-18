import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getSeedRegistry,
  getEnabledAssets,
  getCandidateAssets,
  isEnabledAsset,
  canEnableStatus,
  canEnableAsset,
  registerCandidates,
  findAsset,
} from './registry';

test('注册表：PEPE/DOGE/ETHFI 已启用，BTC 仅作参照', () => {
  const reg = getSeedRegistry();
  const enabled = getEnabledAssets(reg).map((a) => a.id);
  assert.deepEqual(enabled, ['PEPE', 'DOGE', 'ETHFI']);
  const btc = findAsset('BTC', reg);
  assert.equal(btc?.role, 'reference');
  assert.equal(btc?.status, 'verified');
  // BTC 是参照，不属于可选信号池
  assert.equal(isEnabledAsset('BTC', reg), false);
});

test('启用门：candidate / disabled 不得启用，verified / enabled 可启用', () => {
  assert.equal(canEnableStatus('candidate').ok, false);
  assert.equal(canEnableStatus('disabled').ok, false);
  assert.equal(canEnableStatus('verified').ok, true);
  assert.equal(canEnableStatus('enabled').ok, true);
});

test('无基线标的（ETHFI）可启用，但研究基线标记为 false', () => {
  const ethfi = findAsset('ETHFI');
  assert.equal(ethfi?.hasHistoryBaseline, false);
  assert.equal(canEnableAsset(ethfi!).ok, true);
});

test('候选注册：OKX 新永续登记为 candidate，绝不 enabled', () => {
  const seed = getSeedRegistry();
  const next = registerCandidates(
    [
      { instId: 'NEWCOIN-USDT-SWAP', state: 'live' },
      { instId: 'SPOT-USDT', state: 'live' }, // 非永续，忽略
      { instId: 'PEPE-USDT-SWAP', state: 'live' }, // 已存在，保持原状态
    ],
    seed,
  );
  const newAsset = findAsset('NEWCOIN', next);
  assert.equal(newAsset?.status, 'candidate');
  assert.equal(newAsset?.verifiedAt, null);
  assert.equal(newAsset?.source, 'okx');
  assert.equal(canEnableAsset(newAsset!).ok, false);
  // 已存在的 PEPE 状态不被目录覆盖
  assert.equal(findAsset('PEPE', next)?.status, 'enabled');
  // 非永续未登记
  assert.equal(getCandidateAssets(next).some((a) => a.instId === 'SPOT-USDT'), false);
});

test('候选注册幂等：重复注册不产生重复记录', () => {
  const instruments = [{ instId: 'NEWCOIN-USDT-SWAP', state: 'live' }];
  const once = registerCandidates(instruments, getSeedRegistry());
  const twice = registerCandidates(instruments, once);
  assert.equal(twice.filter((a) => a.instId === 'NEWCOIN-USDT-SWAP').length, 1);
  assert.equal(once.length, twice.length);
});
