import { NextResponse } from 'next/server';
import {
  getEventBtcCandles,
  getEventCandles,
  getHistoricalEventById,
  getSnapshotFunding,
} from '@/lib/data-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const event = getHistoricalEventById(id);
  if (!event) {
    return NextResponse.json({ ok: false, error: 'not_found', message: `未找到事件 ${id}` }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    data: {
      event,
      candles: getEventCandles(event, event.coin),
      btcCandles: getEventBtcCandles(event),
      funding: getSnapshotFunding(event.coin),
    },
  });
}