import { NextResponse } from 'next/server';
import { tryOpenDb } from '@/lib/server/sqlite';
import { isValidPushSubscription, savePushSubscription } from '@/lib/server/push-repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 保存浏览器推送订阅（幂等 upsert）；订阅数据只落本地 SQLite，不进 Git。 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  if (!isValidPushSubscription(body)) {
    return NextResponse.json({ ok: false, error: 'invalid_subscription' }, { status: 400 });
  }
  const db = tryOpenDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: 'db_unavailable' }, { status: 503 });
  }
  try {
    savePushSubscription(db, body);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'save_failed' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
