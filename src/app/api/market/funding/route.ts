import { NextResponse } from 'next/server';
import { getFunding, type FundingCoin } from '@/lib/market-client';
import { TRADE_COINS } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 可查资金费率的标的（唯一来源：config.TRADE_COINS；BTC 无资金费率，不在列）。 */
const FUNDING_COINS: readonly string[] = TRADE_COINS;

/**
 * 资金费率：Binance 优先，失败自动切到 OKX 公开接口（同为实时数据，非快照）。
 * 两者都失败返回 503 与真实诊断。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = (url.searchParams.get('coin') ?? 'PEPE').toUpperCase();
  if (!FUNDING_COINS.includes(coin)) {
    return NextResponse.json({ ok: false, error: 'invalid_coin' }, { status: 400 });
  }
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30) || 30));

  const res = await getFunding(coin as FundingCoin, limit);
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        source: 'unavailable',
        error: res.error,
        message: `资金费率实时接口不可用：${res.diag.errorDetail ?? res.error}`,
        diag: res.diag,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    source: 'live',
    provider: res.data.provider,
    degraded: res.data.provider === 'okx',
    note: res.data.provider === 'okx' ? 'Binance 不可用，已切换至 OKX 实时资金费率' : undefined,
    fetchedAt: Date.now(),
    data: { symbol: res.data.symbol, points: res.data.points },
    diag: res.diag,
  });
}
