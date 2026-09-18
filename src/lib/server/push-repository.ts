/**
 * Web Push 订阅 Repository（仅服务端；浏览器不接触 .db，也不散落 SQL）。
 *
 * 一行一订阅（endpoint 主键）：插入/更新幂等 upsert，删除按 endpoint。
 * 可注入 db（测试用隔离临时库）；默认走进程单例 getDb()。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { PushSubscriptionKeys, PushSubscriptionRecord } from '../push';

export interface PushSubscriptionInput {
  endpoint: string;
  keys: PushSubscriptionKeys;
}

interface PushRow {
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: number;
}

/** 订阅入参校验：endpoint 非空、keys.p256dh/auth 非空字符串。 */
export function isValidPushSubscription(input: unknown): input is PushSubscriptionInput {
  const v = input as Partial<PushSubscriptionInput> | null | undefined;
  const keys = v?.keys as Partial<PushSubscriptionKeys> | undefined;
  return (
    typeof v?.endpoint === 'string' &&
    v.endpoint.trim().length > 0 &&
    typeof keys?.p256dh === 'string' &&
    keys.p256dh.trim().length > 0 &&
    typeof keys?.auth === 'string' &&
    keys.auth.trim().length > 0
  );
}

/** 读取全部订阅（损坏行跳过；字段缺失视为损坏）。 */
export function readPushSubscriptions(db: DatabaseSync): PushSubscriptionRecord[] {
  let rows: PushRow[];
  try {
    rows = db
      .prepare('SELECT endpoint, p256dh, auth, created_at FROM push_subscriptions')
      .all() as unknown as PushRow[];
  } catch {
    return [];
  }
  const out: PushSubscriptionRecord[] = [];
  for (const row of rows) {
    const endpoint = String(row.endpoint ?? '');
    const p256dh = String(row.p256dh ?? '');
    const auth = String(row.auth ?? '');
    if (!endpoint || !p256dh || !auth) continue;
    out.push({ endpoint, keys: { p256dh, auth }, createdAt: Number(row.created_at) });
  }
  return out;
}

export function countPushSubscriptions(db: DatabaseSync): number {
  return readPushSubscriptions(db).length;
}

/** 幂等 upsert（同 endpoint 覆盖 keys 并刷新 created_at）；事务内执行。 */
export function savePushSubscription(
  db: DatabaseSync,
  input: PushSubscriptionInput,
  now: number = Date.now(),
): void {
  if (!isValidPushSubscription(input)) throw new Error('push_subscription_invalid');
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         created_at = excluded.created_at`,
    ).run(input.endpoint, input.keys.p256dh, input.keys.auth, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** 按 endpoint 删除；返回是否删除了一行。 */
export function deletePushSubscription(db: DatabaseSync, endpoint: string): boolean {
  const res = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  return Number(res.changes) > 0;
}
