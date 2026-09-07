import { NextResponse } from 'next/server';
import { getBinanceFunding } from '@/lib/market-client';
import { getSnapshotFunding } from '@/lib/data-store';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = (url.searchParams.get('coin') ?? 'PEPE').toUpperCase();
  if (coin !== 'PEPE' && coin !== 'DOGE') {
    return NextResponse.json({ ok: false, error: 'invalid_coin' }, { status: 400 });
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30) || 30));
  try {
    const data = await getBinanceFunding(coin, limit);
    return NextResponse.json({ ok: true, source: 'live', data: { symbol: coin, points: data } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    // 线下/受限网络下，回退到历史资金费率快照（明确标注）。
    const snap = getSnapshotFunding(coin);
    if (snap.length) {
      return NextResponse.json({
        ok: true,
        source: 'snapshot',
        degraded: true,
        note: '实时资金费率不可用，已回退到历史快照',
        data: { symbol: coin, points: snap.slice(-limit) },
      });
    }
    return NextResponse.json(
      { ok: false, error: message, message: '资金费率接口不可用（可能受网络策略限制）' },
      { status: 503 },
    );
  }
}