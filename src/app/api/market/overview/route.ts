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
    // Phase A K 线新鲜度（期望收盘 Bar 对比口径）：
    // lastConfirmedOpenTs/lastConfirmedCloseTs（per coin）/
    // expectedLastConfirmedOpenTs/CloseTs / current4HOpenTs /
    // candleLagBars（per coin）/ freshnessStatus / staleReason（编码）。
    candle: {
      current4HOpenTs: overview.candle.current4HOpenTs,
      expectedLastConfirmedOpenTs: overview.candle.expectedLastConfirmedOpenTs,
      expectedLastConfirmedCloseTs: overview.candle.expectedLastConfirmedCloseTs,
      lastConfirmedOpenTs: {
        PEPE: overview.candle.perCoin.PEPE.actualLastConfirmedOpenTs,
        DOGE: overview.candle.perCoin.DOGE.actualLastConfirmedOpenTs,
        BTC: overview.candle.perCoin.BTC.actualLastConfirmedOpenTs,
      },
      lastConfirmedCloseTs: {
        PEPE: overview.candle.perCoin.PEPE.actualLastConfirmedCloseTs,
        DOGE: overview.candle.perCoin.DOGE.actualLastConfirmedCloseTs,
        BTC: overview.candle.perCoin.BTC.actualLastConfirmedCloseTs,
      },
      candleLagBars: {
        PEPE: overview.candle.perCoin.PEPE.candleLagBars,
        DOGE: overview.candle.perCoin.DOGE.candleLagBars,
        BTC: overview.candle.perCoin.BTC.candleLagBars,
      },
      freshnessStatus: overview.candle.status,
      staleReason: overview.candle.staleReason,
    },
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
