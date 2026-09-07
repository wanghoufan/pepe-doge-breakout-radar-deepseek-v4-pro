import { NextResponse } from 'next/server';
import {
  getHistoricalEventById,
  getSnapshotCandles,
  getSnapshotFunding,
} from '@/lib/data-store';

export const dynamic = 'force-dynamic';

/**
 * 返回某个历史事件「启动前」的 K 线/资金费率快照，
 * 供方法论页的「阈值回放实验」在本地用候选阈值重新跑引擎（快照重放，非预测）。
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const event = getHistoricalEventById(id);
  if (!event) {
    return NextResponse.json({ ok: false, error: 'not_found', message: `未找到事件 ${id}` }, { status: 404 });
  }
  const coin = event.coin;
  const from = event.startTs - 10 * 86_400_000;
  const coinCandles = getSnapshotCandles(coin).filter((c) => c.ts >= from && c.ts <= event.startTs);
  const btcCandles = getSnapshotCandles('BTC').filter((c) => c.ts >= from && c.ts <= event.startTs);
  const funding = getSnapshotFunding(coin).filter((r) => r.ts >= from && r.ts <= event.startTs);

  return NextResponse.json({
    ok: true,
    data: { asset: coin, startTs: event.startTs, candles: coinCandles, btcCandles, funding },
  });
}