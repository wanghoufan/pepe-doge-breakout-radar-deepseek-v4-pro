import { NextResponse } from 'next/server';
import { getMarketOverview, envSummary } from '@/lib/market-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  const overview = await getMarketOverview();
  const live = overview.status === 'live';
  const summary = live
    ? envSummary(overview.btc, overview.pepe, overview.doge)
    : `OKX 实时数据不可用：${overview.error ?? '未知原因'}`;

  return NextResponse.json({
    ok: true,
    status: overview.status,
    generatedAt: overview.generatedAt,
    summary,
    error: overview.error ?? null,
    errors: overview.errors,
    fundingProvider: overview.fundingProvider,
    freshness: overview.freshness,
    fundingTs: overview.fundingTs,
    data: {
      btc: overview.btc,
      pepe: overview.pepe,
      doge: overview.doge,
      lastCandleTs: overview.lastCandleTs,
      lastConfirmedTs: overview.lastConfirmedTs,
      intraday: overview.intraday,
      prices: overview.prices,
      sources: overview.sources,
    },
  });
}
