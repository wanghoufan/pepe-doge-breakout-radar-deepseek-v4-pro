import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineState } from './state-machine';

test('BTC 硬否决 → forbidden', () => {
  const s = determineState({
    hardVeto: true,
    hardVetoKind: 'btc',
    breakoutTriggered: true,
    overheated: false,
    preparationCompletion: 0.9,
    distanceToBreakoutPct: 0,
  });
  assert.equal(s, 'forbidden');
});

test('币种结构失效 → invalidated', () => {
  const s = determineState({
    hardVeto: true,
    hardVetoKind: 'coin',
    breakoutTriggered: false,
    overheated: false,
    preparationCompletion: 0.9,
    distanceToBreakoutPct: 0,
  });
  assert.equal(s, 'invalidated');
});

test('突破触发且未过热 → breakout_confirmed', () => {
  const s = determineState({
    hardVeto: false,
    hardVetoKind: null,
    breakoutTriggered: true,
    overheated: false,
    preparationCompletion: 0.5,
    distanceToBreakoutPct: 1,
  });
  assert.equal(s, 'breakout_confirmed');
});

test('突破触发且过热 → awaiting_pullback', () => {
  const s = determineState({
    hardVeto: false,
    hardVetoKind: null,
    breakoutTriggered: true,
    overheated: true,
    preparationCompletion: 0.5,
    distanceToBreakoutPct: 3,
  });
  assert.equal(s, 'awaiting_pullback');
});

test('未触发、蓄势完成度 ≥ 0.6 → near_breakout', () => {
  const s = determineState({
    hardVeto: false,
    hardVetoKind: null,
    breakoutTriggered: false,
    overheated: false,
    preparationCompletion: 0.6,
    distanceToBreakoutPct: -1,
  });
  assert.equal(s, 'near_breakout');
});

test('未触发、蓄势完成度 < 0.6 → accumulating', () => {
  const s = determineState({
    hardVeto: false,
    hardVetoKind: null,
    breakoutTriggered: false,
    overheated: false,
    preparationCompletion: 0.2,
    distanceToBreakoutPct: null,
  });
  assert.equal(s, 'accumulating');
});