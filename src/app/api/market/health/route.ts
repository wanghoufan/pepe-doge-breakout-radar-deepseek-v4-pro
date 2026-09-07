import { NextResponse } from 'next/server';
import {
  getBinanceFunding,
  getFunding,
  getOkxCandles,
  getOkxFunding,
  getOkxTickers,
  MARKET_META,
  type FetchDiag,
  type FundingCoin,
} from '@/lib/market-client';

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

  const [btc, pepe, doge, tickers, binancePepe, okxPepe, binanceDoge, okxDoge, fundingPepe, fundingDoge] =
    await Promise.all([
      getOkxCandles('BTC', '4H', 5),
      getOkxCandles('PEPE', '4H', 5),
      getOkxCandles('DOGE', '4H', 5),
      getOkxTickers(['BTC', 'PEPE', 'DOGE']),
      getBinanceFunding('PEPE' as FundingCoin, 5),
      getOkxFunding('PEPE' as FundingCoin, 5),
      getBinanceFunding('DOGE' as FundingCoin, 5),
      getOkxFunding('DOGE' as FundingCoin, 5),
      getFunding('PEPE' as FundingCoin, 5),
      getFunding('DOGE' as FundingCoin, 5),
    ]);

  const probes: ProbeResult[] = [
    probe('okx:candles:BTC-USDT-SWAP:4H', 'okx', btc, btc.ok ? btc.data.confirmedCandles.at(-1) : undefined),
    probe('okx:candles:PEPE-USDT-SWAP:4H', 'okx', pepe, pepe.ok ? pepe.data.confirmedCandles.at(-1) : undefined),
    probe('okx:candles:DOGE-USDT-SWAP:4H', 'okx', doge, doge.ok ? doge.data.confirmedCandles.at(-1) : undefined),
    probe('okx:tickers:BTC/PEPE/DOGE', 'okx', tickers, tickers.ok ? tickers.data : undefined),
    probe('binance:funding:1000PEPEUSDT', 'binance', binancePepe, binancePepe.ok ? binancePepe.data.at(-1) : undefined),
    probe('okx:funding:PEPE-USDT-SWAP', 'okx', okxPepe, okxPepe.ok ? okxPepe.data.at(-1) : undefined),
    probe('binance:funding:DOGEUSDT', 'binance', binanceDoge, binanceDoge.ok ? binanceDoge.data.at(-1) : undefined),
    probe('okx:funding:DOGE-USDT-SWAP', 'okx', okxDoge, okxDoge.ok ? okxDoge.data.at(-1) : undefined),
    probe('funding:resolved:PEPE', fundingPepe.ok ? fundingPepe.data.provider : 'binance', fundingPepe, fundingPepe.ok ? fundingPepe.data.provider : undefined),
    probe('funding:resolved:DOGE', fundingDoge.ok ? fundingDoge.data.provider : 'binance', fundingDoge, fundingDoge.ok ? fundingDoge.data.provider : undefined),
  ];

  const okxOk = btc.ok && pepe.ok && doge.ok && tickers.ok;
  const binanceOk = binancePepe.ok && binanceDoge.ok;

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
      funding: fundingPepe.ok || fundingDoge.ok ? 'ok' : 'failed',
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
