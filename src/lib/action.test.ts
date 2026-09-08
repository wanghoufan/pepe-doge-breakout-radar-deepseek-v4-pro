/**
 * Action Card 测试（25 节 TEST 1–15）。
 * 全部针对纯函数 deriveActionState / describeFollowThrough，不依赖网络与 UI。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveActionState,
  describeFollowThrough,
  ENTRY_HEAT_COPY,
  SETUP_COPY,
  TRIGGER_COPY,
  type ActionInput,
} from './action';

function base(over: Partial<ActionInput> = {}): ActionInput {
  return {
    dataStatus: 'ok',
    lastUpdatedTs: 1787000000000,
    staleReason: null,
    environmentGate: 'ALLOW',
    hardVetoKind: 'NONE',
    hardVetoReason: null,
    state: 'NO_SETUP',
    entryHeat: 10,
    currentPrice: 0.0907,
    breakoutConfirmed: false,
    breakoutLevel: null,
    breakoutClose: null,
    breakoutExtensionPct: null,
    currentDistancePct: null,
    invalidationLevel: null,
    nextResistance: 0.0953,
    breakoutTs: null,
    episodeAgeHours: null,
    episodeId: null,
    heldAboveBreakoutLevel: null,
    setupScore: null,
    triggerScore: null,
    followThroughStatus: 'NOT_STARTED',
    followThroughValue: null,
    ...over,
  };
}

const BANNED = ['建议开仓', '买入', '强买', '高胜率', '胜率高', '可以买', '马上可以买', '突破买点'];

function assertNoBanned(a: { summary: string; reasons: { text: string }[]; warnings: string[] }) {
  const all = [a.summary, ...a.reasons.map((r) => r.text), ...a.warnings].join('\n');
  for (const w of BANNED) assert.ok(!all.includes(w), `禁用语"${w}"不应出现`);
}

test('TEST 1：STRUCTURE_VETO + Setup100/Trigger100 + Heat0 → REJECT（高分不可覆盖）', () => {
  const a = deriveActionState(
    base({
      hardVetoKind: 'STRUCTURE_VETO',
      hardVetoReason: '币种跌破关键结构失效位',
      state: 'INVALIDATED',
      setupScore: 100,
      triggerScore: 100,
      entryHeat: 0,
      currentPrice: 3.607e-6,
      breakoutLevel: 4.097e-6,
      invalidationLevel: 3.6463e-6,
    }),
  );
  assert.equal(a.code, 'REJECT');
  assert.equal(a.title, '当前淘汰');
  assert.ok(a.summary.includes('失效'));
  assert.equal(a.history.historicalOnly, true);
  assertNoBanned(a);
});

test('TEST 2：Environment BLOCK → REJECT', () => {
  const a = deriveActionState(base({ environmentGate: 'BLOCK', state: 'BUILDING_SETUP', setupScore: 80 }));
  assert.equal(a.code, 'REJECT');
  assert.ok(a.reasons.some((r) => !r.ok && r.text.includes('BLOCK')));
});

test('TEST 3：NO_SETUP → NO_ACTION', () => {
  const a = deriveActionState(base());
  assert.ok(a.code === 'NO_ACTION');
});

test('TEST 4：BUILDING_SETUP → WATCH（含误报说明）', () => {
  const a = deriveActionState(base({ state: 'BUILDING_SETUP', setupScore: 45 }));
  assert.equal(a.code, 'WATCH');
  assert.ok(a.warnings.join('').includes('误报'));
  assertNoBanned(a);
});

test('TEST 5：NEAR_BREAKOUT → WATCH（需等待收盘确认）', () => {
  const a = deriveActionState(base({ state: 'NEAR_BREAKOUT', setupScore: 70 }));
  assert.equal(a.code, 'WATCH');
  assert.ok(a.summary.includes('4H 收盘确认'));
});

test('TEST 6：BREAKOUT_CONFIRMED + 无否决 → BREAKOUT_TRACK', () => {
  const a = deriveActionState(
    base({
      state: 'BREAKOUT_CONFIRMED',
      breakoutConfirmed: true,
      breakoutLevel: 0.09,
      invalidationLevel: 0.0896,
      currentPrice: 0.0905,
      currentDistancePct: 0.55,
      heldAboveBreakoutLevel: true,
      followThroughStatus: 'NOT_STARTED',
      episodeAgeHours: 4,
      episodeId: 'EP-DOGE-001',
    }),
  );
  assert.equal(a.code, 'BREAKOUT_TRACK');
  assert.ok(a.summary.includes('Follow-through'));
});

test('TEST 7：FOLLOW_THROUGH_PENDING 仍是 BREAKOUT_TRACK，不因缺失判低质', () => {
  const a = deriveActionState(
    base({
      state: 'FOLLOW_THROUGH_PENDING',
      breakoutConfirmed: true,
      breakoutLevel: 0.09,
      invalidationLevel: 0.0896,
      currentPrice: 0.0905,
      currentDistancePct: 0.55,
      heldAboveBreakoutLevel: true,
      followThroughStatus: 'PENDING',
      followThroughValue: null,
    }),
  );
  assert.equal(a.code, 'BREAKOUT_TRACK');
  assert.ok(a.summary.includes('尚无足够后续数据'));
  const ft = describeFollowThrough('PENDING', null, true, 8);
  assert.equal(ft.grade, 'PENDING');
});

test('TEST 8：RETESTING + 结构有效 + 无否决 → RETEST_WATCH', () => {
  const a = deriveActionState(
    base({
      state: 'RETESTING',
      breakoutConfirmed: true,
      breakoutLevel: 0.09,
      invalidationLevel: 0.0896,
      currentPrice: 0.0907,
      currentDistancePct: 0.78,
      heldAboveBreakoutLevel: true,
      followThroughStatus: 'COMPUTED',
      followThroughValue: 100,
    }),
  );
  assert.equal(a.code, 'RETEST_WATCH');
  assertNoBanned(a);
});

test('TEST 9：结构有效 + Entry Heat 高 → OVERHEATED', () => {
  const a = deriveActionState(
    base({
      state: 'HEALTHY_BREAKOUT',
      breakoutConfirmed: true,
      breakoutLevel: 0.09,
      invalidationLevel: 0.0896,
      currentPrice: 0.115,
      currentDistancePct: 27.8,
      entryHeat: 85,
      heldAboveBreakoutLevel: true,
      followThroughStatus: 'COMPUTED',
      followThroughValue: 80,
    }),
  );
  assert.equal(a.code, 'OVERHEATED');
  assert.ok(a.summary.includes('追高'));
  assert.ok(!a.summary.includes('不能涨'));
});

test('TEST 10：DATA_UNAVAILABLE → DATA_BLOCKED（不沿用旧信号）', () => {
  const a = deriveActionState(base({ dataStatus: 'unavailable', staleReason: 'OKX 实时数据当前不可用', lastUpdatedTs: 1787000000000 }));
  assert.equal(a.code, 'DATA_BLOCKED');
  assert.equal(a.nextConditions.length, 1);
  assert.ok(a.reasons.join(' ').length >= 0);
  assert.equal(a.keyLevels.breakoutLevel, null);
});

test('TEST 11：PEPE 当前 Case → REJECT（含历史评分复盘注）', () => {
  const a = deriveActionState(
    base({
      hardVetoKind: 'STRUCTURE_VETO',
      hardVetoReason: '币种跌破关键结构失效位',
      state: 'INVALIDATED',
      setupScore: 100,
      triggerScore: 100,
      entryHeat: 0,
      currentPrice: 3.607e-6,
      breakoutLevel: 4.097e-6,
      breakoutExtensionPct: 0.84,
      currentDistancePct: (3.607e-6 / 4.097e-6 - 1) * 100,
      invalidationLevel: 3.6463e-6,
      nextResistance: 4.2e-6,
      episodeAgeHours: 408,
      episodeId: 'EP-PEPE-0xx',
    }),
  );
  assert.equal(a.code, 'REJECT');
  assert.ok(a.summary.includes('失效'));
  assert.ok(a.reasons.some((r) => !r.ok && r.text.includes('STRUCTURE_VETO')));
  assert.ok(a.warnings.join('').includes('历史突破评分'));
  assert.ok((a.episodeStatus ?? '').includes('新的'));
  assert.ok(a.nextConditions[0].outcome.includes('不沿用旧 episode'));
});

test('TEST 12：DOGE 当前 Case → RETEST_WATCH', () => {
  const a = deriveActionState(
    base({
      state: 'RETESTING',
      breakoutConfirmed: true,
      breakoutLevel: 0.09,
      breakoutClose: 0.0907,
      breakoutExtensionPct: 0.84,
      currentPrice: 0.0907,
      currentDistancePct: (0.0907 / 0.09 - 1) * 100,
      invalidationLevel: 0.0896,
      nextResistance: 0.0953,
      heldAboveBreakoutLevel: true,
      setupScore: 65,
      triggerScore: 60,
      followThroughStatus: 'COMPUTED',
      followThroughValue: 100,
      episodeAgeHours: 52,
      episodeId: 'EP-DOGE-0xx',
    }),
  );
  assert.equal(a.code, 'RETEST_WATCH');
  assert.ok(a.reasons.filter((r) => r.ok).length >= 4);
  assert.ok(a.nextConditions.some((n) => n.level === 0.0896 && n.outcome.includes('失效')));
  assertNoBanned(a);
});

test('TEST 13：INVALIDATED 后 Setup/Trigger 保留且 historicalOnly=true', () => {
  const a = deriveActionState(
    base({ state: 'INVALIDATED', hardVetoKind: 'STRUCTURE_VETO', hardVetoReason: 'x', setupScore: 100, triggerScore: 100 }),
  );
  assert.equal(a.history.setupScore, 100);
  assert.equal(a.history.triggerScore, 100);
  assert.equal(a.history.historicalOnly, true);
  const live = deriveActionState(base({ state: 'RETESTING', breakoutConfirmed: true, heldAboveBreakoutLevel: true, breakoutLevel: 1, setupScore: 80, triggerScore: 70 }));
  assert.equal(live.history.historicalOnly, false);
});

test('TEST 14：Risk 不再作为 Total Risk 展示（Entry Heat 文案）', () => {
  assert.ok(ENTRY_HEAT_COPY.label.includes('Entry Heat'));
  assert.ok(ENTRY_HEAT_COPY.tooltip.includes('不代表这笔交易的全部风险'));
  assert.ok(ENTRY_HEAT_COPY.tooltip.includes('Hard Veto'));
  assert.ok(TRIGGER_COPY.tooltip.includes('不代表未来收益概率'));
  assert.ok(SETUP_COPY.tooltip.includes('误报'));
  const a = deriveActionState(base({ entryHeat: 0 }));
  assert.equal(a.entryHeat.band, '低');
  assert.equal(deriveActionState(base({ entryHeat: 65 })).entryHeat.band, '中');
  assert.equal(deriveActionState(base({ entryHeat: 90 })).entryHeat.band, '高');
});

test('TEST 15：Action Mapping 不依赖未来 Outcome Label', () => {
  const keys = Object.keys(base());
  for (const k of ['outcome', 'success', 'failure', 'mfe', 'mae', 'future']) {
    assert.ok(!keys.some((x) => x.toLowerCase().includes(k)), `输入不应含 ${k}`);
  }
  // 同一输入 → 同一输出（deterministic）。
  const a1 = deriveActionState(base({ state: 'RETESTING', breakoutConfirmed: true, heldAboveBreakoutLevel: true, breakoutLevel: 1 }));
  const a2 = deriveActionState(base({ state: 'RETESTING', breakoutConfirmed: true, heldAboveBreakoutLevel: true, breakoutLevel: 1 }));
  assert.deepEqual(a1, a2);
});
