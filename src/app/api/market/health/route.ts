import { NextResponse } from 'next/server';
import {
  getBinanceFunding,
  getFunding,
  getOkxCandles,
  getOkxFunding,
  getOkxTickers,
  MARKET_META,
  type Coin,
  type FetchDiag,
  type FundingCoin,
} from '@/lib/market-client';
import { ASSETS, MARKET_COINS, TRADE_COINS } from '@/lib/config';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface ProbeResult {
  target: string;
  provider: 'okx' | 'binance';
  ok: boolean;
  url: string | null;
  host: string | null;
  httpStatus: number | null;
  vendorCode: string | null;
  vendorMsg: string | null;
  errorKind: string | null;
  errorDetail: string | null;
  durationMs: number;
  cached: boolean;
  attempts: FetchDiag['attempts'];
  sample?: unknown;
}

function probe(
  target: string,
  provider: 'okx' | 'binance',
  r: { ok: boolean; diag: FetchDiag },
  sample?: unknown,
): ProbeResult {
  const d = r.diag;
  return {
    target,
    provider,
    ok: r.ok,
    url: d.url,
    host: d.host,
    httpStatus: d.httpStatus,
    vendorCode: d.vendorCode,
    vendorMsg: d.vendorMsg,
    errorKind: r.ok && d.errorKind === 'none' ? null : d.errorKind,
    errorDetail: d.errorDetail,
    durationMs: d.durationMs,
    cached: d.cached,
    attempts: d.attempts,
    sample,
  };
}

/**
 * 连通性诊断：逐个真实请求 OKX / Binance，输出请求地址、HTTP 状态码、
 * 交易所 code/msg、DNS/网络/超时错误与耗时。用于确认部署环境能否访问交易所。
 */
export async function GET() {
  const started = Date.now();

  // 探测标的唯一来源：config（K 线/现价走 MARKET_COINS，资金费率走 TRADE_COINS，三币同路径）。
  const candleCoins = [...MARKET_COINS] as Coin[];
  const fundingCoins = [...TRADE_COINS] as FundingCoin[];

  const [candles, tickers, binanceFundings, okxFundings, resolvedFundings] = await Promise.all([
    Promise.all(candleCoins.map((c) => getOkxCandles(c, '4H', 5))),
    getOkxTickers(candleCoins),
    Promise.all(fundingCoins.map((c) => getBinanceFunding(c, 5))),
    Promise.all(fundingCoins.map((c) => getOkxFunding(c, 5))),
    Promise.all(fundingCoins.map((c) => getFunding(c, 5))),
  ]);
  const byCandle = new Map(candleCoins.map((c, i) => [c, candles[i]!] as const));
  const byBinance = new Map(fundingCoins.map((c, i) => [c, binanceFundings[i]!] as const));
  const byOkx = new Map(fundingCoins.map((c, i) => [c, okxFundings[i]!] as const));
  const byResolved = new Map(fundingCoins.map((c, i) => [c, resolvedFundings[i]!] as const));

  const probes: ProbeResult[] = [
    ...candleCoins.map((c) => {
      const r = byCandle.get(c)!;
      return probe(`okx:candles:${ASSETS[c].instId}:4H`, 'okx', r, r.ok ? r.data.confirmedCandles.at(-1) : undefined);
    }),
    probe(
      `okx:tickers:${candleCoins.join('/')}`,
      'okx',
      tickers,
      tickers.ok ? tickers.data : undefined,
    ),
    ...fundingCoins.flatMap((c) => {
      const b = byBinance.get(c)!;
      const o = byOkx.get(c)!;
      return [
        probe(`binance:funding:${ASSETS[c].fundingBinanceSymbol}`, 'binance', b, b.ok ? b.data.at(-1) : undefined),
        probe(`okx:funding:${ASSETS[c].instId}`, 'okx', o, o.ok ? o.data.at(-1) : undefined),
      ];
    }),
    ...fundingCoins.map((c) => {
      const f = byResolved.get(c)!;
      return probe(
        `funding:resolved:${c}`,
        f.ok ? f.data.provider : 'binance',
        f,
        f.ok ? f.data.provider : undefined,
      );
    }),
  ];

  const okxOk = candles.every((r) => r.ok) && tickers.ok;
  const binanceOk = binanceFundings.every((r) => r.ok);

  return NextResponse.json({
    ok: true,
    generatedAt: started,
    durationMs: Date.now() - started,
    env: {
      runtime: process.env.VERCEL ? `vercel:${process.env.VERCEL_ENV ?? 'unknown'}` : 'local',
      region: process.env.VERCEL_REGION ?? null,
      node: process.version,
      serverTimeUtc: new Date(started).toISOString(),
    },
    summary: {
      okx: okxOk ? 'ok' : 'failed',
      binance: binanceOk ? 'ok' : 'degraded',
      funding: resolvedFundings.some((r) => r.ok) ? 'ok' : 'failed',
    },
    config: {
      okxHosts: MARKET_META.OKX_HOSTS,
      binanceHosts: MARKET_META.BINANCE_HOSTS,
      instruments: MARKET_META.OKX_INST,
      binanceSymbols: MARKET_META.BINANCE_SYMBOL,
      apiKeyRequired: false,
    },
    probes,
  });
}
