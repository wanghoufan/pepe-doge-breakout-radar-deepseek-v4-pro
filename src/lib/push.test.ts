/**
 * 全局推送（Web Push）测试：状态边沿检测 + payload 文案禁语 + 订阅落库。
 * 纯本地，不依赖外网；复用 alert-center 文案与订阅语义。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { openDatabaseAt } from './server/sqlite';
import {
  countPushSubscriptions,
  deletePushSubscription,
  isValidPushSubscription,
  readPushSubscriptions,
  savePushSubscription,
} from './server/push-repository';
import {
  PUSH_BANNED_COPY_WORDS,
  PUSH_DEFAULT_URL,
  buildPushKey,
  buildPushPayload,
  detectActionEdges,
  selectPushableEdges,
  type ActionObservation,
} from './push';
import { DEFAULT_SUBSCRIPTIONS, type SubscribableAction } from './alert-center';
import type { ActionCode } from './action';

const here = dirname(fileURLToPath(import.meta.url));
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function withTempDb<T>(fn: (db: ReturnType<typeof openDatabaseAt>) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'radar-push-'));
  try {
    const db = openDatabaseAt(join(dir, 'test.db'));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const obs = (symbol: string, action: ActionCode, episodeId: string | null = null): ActionObservation => ({
  symbol,
  action,
  episodeId,
  price: 0.123,
  freshnessLabel: '新鲜',
  breakoutLevel: 0.1,
  invalidationLevel: 0.09,
});

/* PUSH1：Migration 0003 建表且版本登记。 */
test('PUSH1：Migration 0003 建立 push_subscriptions 且幂等登记', () => {
  withTempDb((db) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name));
    assert.ok(tables.includes('push_subscriptions'));
    const migrations = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => String(r.version));
    assert.deepEqual(migrations, ['0001_init.sql', '0002_asset_verification.sql', '0003_push_subscriptions.sql']);
  });
});

/* PUSH2：边沿检测——冷启动只建基线，状态变化才报。 */
test('PUSH2：detectActionEdges 只报变化边沿，冷启动不报', () => {
  let r = detectActionEdges({}, [obs('PEPE', 'WATCH', 'e1')]);
  assert.equal(r.edges.length, 0, '冷启动不报');
  assert.equal(r.next.PEPE, 'WATCH');

  r = detectActionEdges(r.next, [obs('PEPE', 'BREAKOUT_TRACK', 'e1')]);
  assert.equal(r.edges.length, 1, '状态变化报一次');
  assert.equal(r.edges[0].action, 'BREAKOUT_TRACK');

  r = detectActionEdges(r.next, [obs('PEPE', 'BREAKOUT_TRACK', 'e1')]);
  assert.equal(r.edges.length, 0, '同状态不报');

  // 新 Episode 但 Action 未变：仍不算变化（R2 prev==cur）
  r = detectActionEdges({ PEPE: 'BREAKOUT_TRACK' }, [obs('PEPE', 'BREAKOUT_TRACK', 'e2')]);
  assert.equal(r.edges.length, 0);

  // 首次出现的标的不算边沿；notifyOnFirstSeen=true 时才报
  const absent = detectActionEdges({ PEPE: 'WATCH' }, [obs('PEPE', 'WATCH'), obs('DOGE', 'REJECT', 'd1')]);
  assert.equal(absent.edges.length, 0);
  const firstSeen = detectActionEdges({}, [obs('PEPE', 'WATCH')], { notifyOnFirstSeen: true });
  assert.equal(firstSeen.edges.length, 1);
});

/* PUSH3：去重键 = symbol|episodeId|actionState。 */
test('PUSH3：buildPushKey 格式', () => {
  assert.equal(buildPushKey('PEPE', 'ep7', 'REJECT'), 'PEPE|ep7|REJECT');
  assert.equal(buildPushKey('WIF', null, 'WATCH'), 'WIF|no-episode|WATCH');
});

/* PUSH4：订阅过滤 + 去重（WATCH 默认关；已推送键不再报；NO_ACTION 永不报）。 */
test('PUSH4：selectPushableEdges 订阅/去重过滤', () => {
  const edges = [obs('PEPE', 'BREAKOUT_TRACK', 'e1'), obs('DOGE', 'WATCH', 'd1'), obs('PEPE', 'NO_ACTION', 'e1')];
  const only = selectPushableEdges(edges, { subscriptions: { ...DEFAULT_SUBSCRIPTIONS }, seenKeys: [] });
  assert.deepEqual(only.map((e) => e.action), ['BREAKOUT_TRACK']);

  const seen = selectPushableEdges(edges, { subscriptions: { ...DEFAULT_SUBSCRIPTIONS }, seenKeys: [buildPushKey('PEPE', 'e1', 'BREAKOUT_TRACK')] });
  assert.equal(seen.length, 0);

  const watchOn = selectPushableEdges([obs('DOGE', 'WATCH', 'd1')], { subscriptions: { ...DEFAULT_SUBSCRIPTIONS, WATCH: true }, seenKeys: [] });
  assert.equal(watchOn.length, 1);
});

/* PUSH5：payload 文案禁语（买入/胜率/概率/必涨等）+ 四字段 + NO_ACTION 返回 null。 */
test('PUSH5：buildPushPayload 文案禁语与字段', () => {
  for (const action of Object.keys(DEFAULT_SUBSCRIPTIONS) as SubscribableAction[]) {
    const payload = buildPushPayload(obs('PEPE', action, 'e1'));
    assert.ok(payload, `${action} 应可组 payload`);
    assert.ok(payload!.title.includes('PEPE'), `${action} title 含标的`);
    assert.equal(payload!.url, PUSH_DEFAULT_URL);
    assert.equal(payload!.tag, buildPushKey('PEPE', 'e1', action));
    assert.ok(payload!.body.length >= 10);
    for (const w of PUSH_BANNED_COPY_WORDS) {
      assert.ok(!payload!.title.includes(w), `${action} title 含禁语 ${w}`);
      assert.ok(!payload!.body.includes(w), `${action} body 含禁语 ${w}`);
    }
  }
  assert.equal(buildPushPayload(obs('PEPE', 'NO_ACTION', null)), null);
});

/* PUSH6：订阅落库——upsert/读回/删除 + 入参校验。 */
test('PUSH6：push_subscriptions 增删读与校验', () => {
  withTempDb((db) => {
    assert.equal(countPushSubscriptions(db), 0);
    const input = { endpoint: 'https://push.example/ep1', keys: { p256dh: 'pub1', auth: 'auth1' } };
    savePushSubscription(db, input, 1000);
    savePushSubscription(db, { endpoint: 'https://push.example/ep2', keys: { p256dh: 'pub2', auth: 'auth2' } }, 2000);
    assert.equal(countPushSubscriptions(db), 2);

    // 幂等 upsert：同 endpoint 覆盖 keys，不新增行
    savePushSubscription(db, { endpoint: input.endpoint, keys: { p256dh: 'pub1b', auth: 'auth1b' } }, 3000);
    assert.equal(countPushSubscriptions(db), 2);
    const ep1 = readPushSubscriptions(db).find((s) => s.endpoint === input.endpoint);
    assert.equal(ep1?.keys.p256dh, 'pub1b');
    assert.equal(ep1?.createdAt, 3000);

    assert.equal(deletePushSubscription(db, input.endpoint), true);
    assert.equal(deletePushSubscription(db, input.endpoint), false);
    assert.equal(countPushSubscriptions(db), 1);

    assert.equal(isValidPushSubscription(input), true);
    assert.equal(isValidPushSubscription({ endpoint: '', keys: { p256dh: 'a', auth: 'b' } }), false);
    assert.equal(isValidPushSubscription({ endpoint: 'x', keys: { p256dh: '', auth: 'b' } }), false);
    assert.equal(isValidPushSubscription(null), false);
  });
});

/* PUSH7：禁未来数据（push.ts / push-service.ts 不含 MFE/MAE/outcome/backtest 等）。 */
test('PUSH7：推送层禁未来数据与量化禁项', () => {
  const src = stripComments(
    fs.readFileSync(join(here, 'push.ts'), 'utf8') +
      fs.readFileSync(join(here, 'server/push-service.ts'), 'utf8'),
  );
  for (const w of ['mfe-mae', 'MFE', 'MAE', 'outcome', 'backtest', 'samples', 'DEFAULT_V2_THRESHOLDS', 'DEFAULT_V2_WEIGHTS']) {
    assert.ok(!src.includes(w), `推送层含禁项 ${w}`);
  }
});
