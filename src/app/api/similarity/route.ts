import { NextResponse } from 'next/server';
import { getHistoricalEvents } from '@/lib/data-store';
import { buildSimilarityMatrix, scatterProjection, SIMILARITY_FEATURES } from '@/lib/similarity';

export const dynamic = 'force-dynamic';

export async function GET() {
  const events = getHistoricalEvents();
  return NextResponse.json({
    ok: true,
    data: {
      features: SIMILARITY_FEATURES.map((f) => ({ key: f.key, label: f.label, lowerBetter: f.lowerBetter })),
      events: events.map((e) => ({
        id: e.id,
        coin: e.coin,
        start: e.start,
        end: e.end,
        campaignId: e.campaignId,
        campaignLabel: e.campaignLabel,
      })),
      matrix: buildSimilarityMatrix(events),
      scatter: scatterProjection(events),
    },
  });
}