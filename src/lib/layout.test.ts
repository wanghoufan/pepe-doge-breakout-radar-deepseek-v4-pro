import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultLayout,
  normalizeLayout,
  fillSlots,
  withTier,
  assignSlot,
  toggleFavorite,
  validateLayoutInput,
  LAYOUT_SCHEMA_VERSION,
} from './layout';
import { getSeedRegistry, getEnabledAssets } from './registry';

const REG = getSeedRegistry();

test('默认布局：4 档、4 个空槽、无收藏', () => {
  const d = defaultLayout();
  assert.equal(d.tier, 4);
  assert.equal(d.slots.length, 4);
  assert.deepEqual(d.slots, [null, null, null, null]);
  assert.deepEqual(d.favorites, []);
  assert.equal(d.schemaVersion, LAYOUT_SCHEMA_VERSION);
});

test('档位即布局：4/6/9 槽位数 = 档位', () => {
  const base = normalizeLayout({ tier: 4, slots: [], favorites: [] }, REG);
  assert.equal(withTier(base, 6, REG).slots.length, 6);
  assert.equal(withTier(base, 9, REG).slots.length, 9);
});

test('确定性补位：收藏优先、注册表顺序次之，不足则空槽', () => {
  const layout = normalizeLayout({ tier: 6, slots: [], favorites: ['DOGE'] }, REG);
  const filled = fillSlots(layout, REG);
  // 只有 3 个已启用标的：DOGE（收藏）优先，其余按注册表顺序 PEPE/ETHFI
  assert.deepEqual(filled.slots, ['DOGE', 'PEPE', 'ETHFI', null, null, null]);
  // 不生成重复卡
  const used = filled.slots.filter(Boolean);
  assert.equal(new Set(used).size, used.length);
});

test('一币一卡：normalize 丢弃重复占用，保留首个', () => {
  const layout = normalizeLayout({ tier: 4, slots: ['PEPE', 'PEPE', 'DOGE', null], favorites: [] }, REG);
  assert.deepEqual(layout.slots, ['PEPE', null, 'DOGE', null]);
});

test('未启用/未知标的从卡槽清除（安全降级）', () => {
  const layout = normalizeLayout({ tier: 4, slots: ['PEPE', 'FAKECOIN', 'BTC', 'DOGE'], favorites: ['FAKECOIN'] }, REG);
  assert.deepEqual(layout.slots, ['PEPE', null, null, 'DOGE']);
  assert.deepEqual(layout.favorites, []);
});

test('缩档保留前 N 槽，收藏不变', () => {
  const layout = normalizeLayout({ tier: 9, slots: ['PEPE', 'DOGE', 'ETHFI', null, null, null, null, null, null], favorites: ['ETHFI'] }, REG);
  const shrunk = withTier(layout, 4, REG);
  assert.equal(shrunk.slots.length, 4);
  assert.deepEqual(shrunk.slots, ['PEPE', 'DOGE', 'ETHFI', null]);
  assert.deepEqual(shrunk.favorites, ['ETHFI']);
});

test('分配卡槽：拒绝重复占用，槽间不串改', () => {
  const layout = normalizeLayout({ tier: 4, slots: ['PEPE', null, null, null], favorites: [] }, REG);
  const ok = assignSlot(layout, 1, 'DOGE', REG);
  assert.equal(ok.error, null);
  assert.equal(ok.layout.slots[1], 'DOGE');
  assert.equal(ok.layout.slots[0], 'PEPE');
  const dup = assignSlot(ok.layout, 2, 'PEPE', REG);
  assert.match(dup.error ?? '', /一币一卡/);
  assert.deepEqual(dup.layout.slots, ok.layout.slots);
});

test('收藏开关：仅对已启用标的生效', () => {
  const base = normalizeLayout({ tier: 4, slots: [], favorites: [] }, REG);
  const added = toggleFavorite(base, 'PEPE', REG);
  assert.deepEqual(added.favorites, ['PEPE']);
  assert.deepEqual(toggleFavorite(added, 'PEPE', REG).favorites, []);
  assert.deepEqual(toggleFavorite(added, 'BTC', REG).favorites, ['PEPE']);
});

test('校验：合法输入通过，非法档位/长度/重复/未启用被拒', () => {
  const okInput = { tier: 4, slots: ['PEPE', 'DOGE', null, null], favorites: ['PEPE'] };
  assert.equal(validateLayoutInput(okInput, REG).ok, true);

  assert.equal(validateLayoutInput({ tier: 5, slots: [] }, REG).ok, false);
  assert.equal(validateLayoutInput({ tier: 4, slots: ['PEPE'], favorites: [] }, REG).ok, false);
  assert.equal(validateLayoutInput({ tier: 4, slots: ['PEPE', 'PEPE', null, null], favorites: [] }, REG).ok, false);
  assert.equal(validateLayoutInput({ tier: 4, slots: ['PEPE', 'NOPE', null, null], favorites: [] }, REG).ok, false);
  assert.equal(validateLayoutInput({ schemaVersion: 99, tier: 4, slots: [null, null, null, null], favorites: [] }, REG).ok, false);
});

test('enabled 集合是布局唯一合法来源', () => {
  const ids = getEnabledAssets(REG).map((a) => a.id);
  const res = validateLayoutInput({ tier: 4, slots: [...ids.slice(0, 3), null], favorites: ids }, REG);
  assert.equal(res.ok, true);
});
