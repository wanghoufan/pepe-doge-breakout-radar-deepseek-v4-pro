import { test } from 'node:test';
import assert from 'node:assert/strict';
import { determineStateV2 } from './state-machine';

const base = {
  hardVeto: 'NONE' as const,
  environmentGate: 'ALLOW' as const,
  breakoutConfirmed: false,
  intradayAttempt: false,
  followThroughStatus: 'NOT_STARTED' as const,
  heldAboveBreakoutLevel: null,
  retesting: false,
  failedBreakout: false,
  invalidated: false,
  setupScore: 80,
};

test('BTC 硬否决 → MARKET_BLOCKED', () => {
  assert.equal(determineStateV2({ ...base, hardVeto: 'BTC_VETO' }), 'MARKET_BLOCKED');
});

test('结构失效硬否决 → INVALIDATED', () => {
  assert.equal(determineStateV2({ ...base, hardVeto: 'STRUCTURE_VETO' }), 'INVALIDATED');
});

test('环境 BLOCK → MARKET_BLOCKED', () => {
  assert.equal(determineStateV2({ ...base, environmentGate: 'BLOCK' }), 'MARKET_BLOCKED');
});

test('突破确认且 Follow-through 未开始 → FOLLOW_THROUGH_PENDING', () => {
  assert.equal(
    determineStateV2({ ...base, breakoutConfirmed: true, followThroughStatus: 'PENDING' }),
    'FOLLOW_THROUGH_PENDING',
  );
});

test('突破确认且站稳突破位 → HEALTHY_BREAKOUT', () => {
  assert.equal(
    determineStateV2({
      ...base,
      breakoutConfirmed: true,
      followThroughStatus: 'COMPUTED',
      heldAboveBreakoutLevel: true,
    }),
    'HEALTHY_BREAKOUT',
  );
});

test('突破确认后快速跌回 → FAILED_BREAKOUT', () => {
  assert.equal(
    determineStateV2({
      ...base,
      breakoutConfirmed: true,
      followThroughStatus: 'COMPUTED',
      heldAboveBreakoutLevel: false,
      failedBreakout: true,
    }),
    'FAILED_BREAKOUT',
  );
});

test('回踩突破位 → RETESTING', () => {
  assert.equal(
    determineStateV2({
      ...base,
      breakoutConfirmed: true,
      followThroughStatus: 'COMPUTED',
      heldAboveBreakoutLevel: true,
      retesting: true,
    }),
    'RETESTING',
  );
});

test('未突破但盘中触及阻力 → NEAR_BREAKOUT', () => {
  assert.equal(determineStateV2({ ...base, intradayAttempt: true }), 'NEAR_BREAKOUT');
});

test('高 Setup 分 → NEAR_BREAKOUT', () => {
  assert.equal(determineStateV2({ ...base, setupScore: 80 }), 'NEAR_BREAKOUT');
});

test('中 Setup 分 → BUILDING_SETUP', () => {
  assert.equal(determineStateV2({ ...base, setupScore: 50 }), 'BUILDING_SETUP');
});

test('低 Setup 分 → NO_SETUP', () => {
  assert.equal(determineStateV2({ ...base, setupScore: 10 }), 'NO_SETUP');
});

test('数据不足（setupScore null）→ NO_SETUP', () => {
  assert.equal(determineStateV2({ ...base, setupScore: null }), 'NO_SETUP');
});
