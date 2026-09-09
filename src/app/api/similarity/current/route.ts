import { NextResponse } from 'next/server';
import { getHistoricalEvents } from '@/lib/data-store';
import { getMarketOverview } from '@/lib/market-service';
import { currentFeatureVector, computeSimilarities, SIMILARITY_FEATURES } from '@/lib/similarity';
import { BASELINE_COINS } from '@/lib/config';
import type { EventMetrics } from '@/lib/event-analysis';
import type { AssetId } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 可查「当前像谁」的标的（唯一来源：有历史基线的标的；ETHFI 暂无基线，不在列）。 */
const VALID_COINS: readonly string[] = BASELINE_COINS;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const coin = (searchParams.get('coin') ?? 'PEPE').toUpperCase() as AssetId;
  if (!VALID_COINS.includes(coin)) {
    return NextResponse.json({ ok: false, error: 'coin 必须为 PEPE 或 DOGE' }, { status: 400 });
  }

  const overview = await getMarketOverview();
  if (overview.status !== 'live' || !overview[coin.toLowerCase() as 'pepe' | 'doge']) {
    return NextResponse.json({ ok: true, status: 'unavailable', coin, data: null });
  }

  const signal = overview[coin.toLowerCase() as 'pepe' | 'doge']!;
  const events: EventMetrics[] = getHistoricalEvents();
  const query = currentFeatureVector(signal.features);
  const ranking = computeSimilarities(query, events);

  return NextResponse.json({
    ok: true,
    status: 'live',
    coin,
    generatedAt: overview.generatedAt,
    data: {
      query: SIMILARITY_FEATURES.map((f, i) => ({ label: f.label, value: query[i] })),
      ranking: ranking.slice(0, 21).map((r) => ({
        eventId: r.eventId,
        score: r.score,
        distance: r.distance,
        sharedDims: r.sharedDims,
      })),
    },
  });
}