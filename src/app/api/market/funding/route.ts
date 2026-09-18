import { NextResponse } from 'next/server';
import { getFundingByInst } from '@/lib/market-client';
import { findEnabledAsset } from '@/lib/registry';
import { getServerRegistry } from '@/lib/server/registry-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * 资金费率：Binance 优先，失败自动切到 OKX 公开接口（同为实时数据，非快照）。
 * 标的解析走启用注册表（seed 三币 + 动态已启用），只接受启用标的；
 * 两者都失败返回 503 与真实诊断。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = (url.searchParams.get('coin') ?? 'PEPE').trim().toUpperCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 30) || 30));

  const asset = findEnabledAsset(coin, getServerRegistry());
  if (!asset) {
    return NextResponse.json(
      { ok: false, error: 'invalid_coin', message: `${coin} 未启用或不在注册表（仅接受已启用标的）` },
      { status: 400 },
    );
  }

  const res = await getFundingByInst(asset.instId, asset.fundingBinanceSymbol, limit);
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
