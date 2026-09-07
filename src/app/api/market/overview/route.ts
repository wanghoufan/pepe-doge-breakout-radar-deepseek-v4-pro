import { NextResponse } from 'next/server';
import { getMarketOverview, envSummary } from '@/lib/market-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const overview = await getMarketOverview();
  const summary = overview.status === 'live'
    ? envSummary(overview.btc, overview.pepe, overview.doge)
    : '实时数据不可用，请以历史研究快照为准';

  return NextResponse.json({
    ok: true,
    status: overview.status,
    generatedAt: overview.generatedAt,
    summary,
    error: overview.error ?? null,
    data: {
      btc: overview.btc,
      pepe: overview.pepe,
      doge: overview.doge,
      lastCandleTs: overview.lastCandleTs,
    },
  });
}