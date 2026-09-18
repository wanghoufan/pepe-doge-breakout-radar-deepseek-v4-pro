import { NextResponse } from 'next/server';
import { readLayout, writeLayout, resetLayout } from '@/lib/server/layout-repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** 观察盘配置：单用户布局 + 收藏（服务端 SQLite，浏览器不接触 .db）。 */
export async function GET() {
  try {
    const { layout, notice, persisted } = readLayout();
    return NextResponse.json({ ok: true, config: layout, notice, persisted });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `配置读取失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  try {
    const result = writeLayout(body);
    if (!result.ok) {
      return NextResponse.json({ ok: false, errors: result.errors, config: result.layout }, { status: 400 });
    }
    return NextResponse.json({ ok: true, config: result.layout, errors: [] });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `配置写入失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    const config = resetLayout();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `配置重置失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
