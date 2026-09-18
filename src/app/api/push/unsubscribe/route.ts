import { NextResponse } from 'next/server';
import { tryOpenDb } from '@/lib/server/sqlite';
import { deletePushSubscription } from '@/lib/server/push-repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 按 endpoint 删除推送订阅（幂等：不存在也返回 ok）。 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return NextResponse.json({ ok: false, error: 'invalid_endpoint' }, { status: 400 });
  }
  const db = tryOpenDb();
  if (!db) {
    return NextResponse.json({ ok: false, error: 'db_unavailable' }, { status: 503 });
  }
  const removed = deletePushSubscription(db, endpoint);
  return NextResponse.json({ ok: true, removed });
}
