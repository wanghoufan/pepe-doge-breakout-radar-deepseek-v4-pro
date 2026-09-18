import { NextResponse } from 'next/server';
import { getOkxCandlesByInst, getOkxSwapInstruments } from '@/lib/market-client';
import { findEnabledAsset, registerCandidates } from '@/lib/registry';
import { getServerRegistry } from '@/lib/server/registry-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const BARS = ['1H', '4H', '1D'];

/**
 * 实时 K 线（服务端代理 OKX 公开接口）。
 * 标的解析走启用注册表（seed 三币 + 动态已启用），只接受启用标的；
 * 失败时返回 503 与真实诊断，绝不用历史快照冒充实时行情。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const coin = (url.searchParams.get('coin') ?? 'PEPE').trim().toUpperCase();
  const bar = url.searchParams.get('bar') ?? '4H';
  const limit = Math.min(300, Math.max(10, Number(url.searchParams.get('limit') ?? 200) || 200));

  if (!BARS.includes(bar)) {
    return NextResponse.json({ ok: false, error: 'invalid_bar' }, { status: 400 });
  }
  const serverReg = getServerRegistry();
  let asset = findEnabledAsset(coin, serverReg);
  if (!asset) {
    // 公开数据读取口径：OKX 永续目录在列即允许读 K 线（启用门只管卡片/信号，不拦公开数据）。
    const dir = await getOkxSwapInstruments();
    if (dir.ok) asset = registerCandidates(dir.data, serverReg).find((a) => a.id === coin) ?? null;
  }
  if (!asset) {
    return NextResponse.json(
      { ok: false, error: 'invalid_coin', message: `${coin} 未启用或不在注册表（仅 OKX 永续目录在列标的可读）` },
      { status: 400 },
    );
  }

  const res = await getOkxCandlesByInst(asset.instId, bar, limit);
  if (!res.ok) {
    return NextResponse.json(
      {
        ok: false,
        source: 'unavailable',
        error: res.error,
        message: `OKX 实时 K 线不可用：${res.diag.errorDetail ?? res.error}`,
        diag: res.diag,
      },
      { status: 503 },
    );
  }

  return NextResponse.json({
    ok: true,
    source: 'live',
    provider: 'okx',
    fetchedAt: res.data.fetchedAt,
    data: {
      instId: res.data.instId,
      bar: res.data.bar,
      candles: res.data.candles,
      confirmedCandles: res.data.confirmedCandles,
      intradayCandle: res.data.intradayCandle,
      lastConfirmedTs: res.data.until,
    },
    diag: res.diag,
  });
}
