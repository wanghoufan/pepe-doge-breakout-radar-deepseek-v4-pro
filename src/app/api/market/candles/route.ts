import { NextResponse } from 'next/server';
import { getOkxCandles, type Coin } from '@/lib/market-client';
import { getSnapshotCandles } from '@/lib/data-store';

export const dynamic = 'force-dynamic';

const COINS: Coin[] = ['PEPE', 'DOGE', 'BTC'];
const BARS = ['1H', '4H', '1D'];

export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = (url.searchParams.get('coin') ?? 'PEPE').toUpperCase() as Coin;
  const bar = url.searchParams.get('bar') ?? '4H';
  const limit = Math.min(300, Math.max(10, Number(url.searchParams.get('limit') ?? 200) || 200));

  if (!COINS.includes(coin)) {
    return NextResponse.json({ ok: false, error: 'invalid_coin' }, { status: 400 });
  }
  if (!BARS.includes(bar)) {
    return NextResponse.json({ ok: false, error: 'invalid_bar' }, { status: 400 });
  }

  try {
    const data = await getOkxCandles(coin, bar, limit);
    return NextResponse.json({
      ok: true,
      source: 'live',
      data: { instId: data.instId, bar: data.bar, candles: data.candles, until: data.until },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    // 线下/受限网络下，4H 用历史快照兜底，保证图表可看（并明确标注为快照）。
    if (bar === '4H') {
      const snap = getSnapshotCandles(coin);
      if (snap.length) {
        const until = snap.at(-1)?.ts ?? null;
        return NextResponse.json({
          ok: true,
          source: 'snapshot',
          degraded: true,
          note: '实时行情不可用，已回退到历史研究快照',
          data: { instId: coin, bar, candles: snap.slice(-limit), until },
        });
      }
    }
    return NextResponse.json(
      { ok: false, error: message, message: '第三方行情接口不可用（可能受网络策略限制）' },
      { status: 503 },
    );
  }
}