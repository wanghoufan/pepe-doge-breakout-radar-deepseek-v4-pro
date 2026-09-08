/**
 * 市场概览编排（V2，仅服务端）。
 *
 * 拉取 BTC / PEPE / DOGE 三方数据，计算 ratio-based 相对强度互馈，
 * 再对 PEPE、DOGE 分别跑 V2 分层引擎（analyzeAssetV2）。
 *
 * 降级口径（不变）：
 * - OKX（价格 + K 线）与 Binance（资金费率）完全独立请求、独立判定成败。
 * - 判定突破只吃「已收盘」4H K 线；盘中未收盘那根只作展示 / INTRABAR 提示。
 * - 任何失败都产出结构化诊断，绝不用历史快照或模拟值冒充实时行情。
 */
import { analyzeAssetV2, computeBtcEnvironment } from './v2/engine';
import { DEFAULT_CONFIG } from './config';
import { deriveOverviewFreshness, type FeedFreshness } from './freshness';
import { relativeReturn } from './relative-strength';
import { getFunding, getOkxCandles, getOkxTickers, type FetchDiag } from './market-client';
import type { AssetSignal, Candle } from './types';

export interface SourceDiag {
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
}

export interface BtcEnv {
  symbol: string;
  price: number | null;
  priceTs: number | null;
  return7dPct: number | null;
  maxDrawdown24hPct: number | null;
  closeAboveEma100: boolean | null;
  hardBreakdown: boolean;
  trend: 'up' | 'down' | 'range' | 'unknown';
  source: 'okx' | 'unavailable';
}

export interface FundingDiag extends Omit<SourceDiag, 'provider'> {
  provider: 'binance' | 'okx' | null;
}

export interface MarketOverview {
  status: 'live' | 'unavailable';
  generatedAt: number;
  error?: string;
  errors: string[];
  btc: BtcEnv;
  pepe: AssetSignal | null;
  doge: AssetSignal | null;
  lastCandleTs: number | null;
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
  intraday: { PEPE: Candle | null; DOGE: Candle | null; BTC: Candle | null };
  prices: Record<'PEPE' | 'DOGE' | 'BTC', { last: number; ts: number } | null>;
  sources: {
    okxCandles: Record<'PEPE' | 'DOGE' | 'BTC', SourceDiag>;
    okxTickers: SourceDiag;
    funding: Record<'PEPE' | 'DOGE', FundingDiag>;
  };
  fundingProvider: 'binance' | 'okx' | null;
  /** P0-1 三态新鲜度（ok/stale/unavailable）+ 最后有效更新；仅可靠性门控，不参与评分。 */
  freshness: FeedFreshness;
  /** P0-3 各币种资金费率末点 ts（无则 null，用于来源新鲜度行）。 */
  fundingTs: Record<'PEPE' | 'DOGE', number | null>;
}

const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);

function diagOf(provider: 'okx' | 'binance', d: FetchDiag, ok: boolean): SourceDiag {
  return {
    provider,
    ok,
    url: d.url,
    host: d.host,
    httpStatus: d.httpStatus,
    vendorCode: d.vendorCode,
    vendorMsg: d.vendorMsg,
    errorKind: ok && d.errorKind === 'none' ? null : d.errorKind,
    errorDetail: d.errorDetail,
    durationMs: d.durationMs,
    cached: d.cached,
  };
}

const EMPTY_DIAG = (provider: 'okx' | 'binance'): SourceDiag => ({
  provider,
  ok: false,
  url: null,
  host: null,
  httpStatus: null,
  vendorCode: null,
  vendorMsg: null,
  errorKind: 'network',
  errorDetail: '未发起请求',
  durationMs: 0,
  cached: false,
});

export async function getMarketOverview(): Promise<MarketOverview> {
  const generatedAt = Date.now();
  const errors: string[] = [];

  const [btcRes, pepeRes, dogeRes, tickerRes, pepeFundRes, dogeFundRes] = await Promise.all([
    getOkxCandles('BTC', '4H', 120),
    getOkxCandles('PEPE', '4H', 120),
    getOkxCandles('DOGE', '4H', 120),
    getOkxTickers(['BTC', 'PEPE', 'DOGE']),
    getFunding('PEPE', 30),
    getFunding('DOGE', 30),
  ]);

  const candleDiag: MarketOverview['sources']['okxCandles'] = {
    BTC: btcRes.ok ? diagOf('okx', btcRes.diag, true) : diagOf('okx', btcRes.diag, false),
    PEPE: pepeRes.ok ? diagOf('okx', pepeRes.diag, true) : diagOf('okx', pepeRes.diag, false),
    DOGE: dogeRes.ok ? diagOf('okx', dogeRes.diag, true) : diagOf('okx', dogeRes.diag, false),
  };
  const tickerDiag = diagOf('okx', tickerRes.diag, tickerRes.ok);
  const fundingDiag: MarketOverview['sources']['funding'] = {
    PEPE: {
      ...(pepeFundRes.ok ? diagOf('binance', pepeFundRes.diag, true) : diagOf('binance', pepeFundRes.diag, false)),
      provider: pepeFundRes.ok ? pepeFundRes.data.provider : null,
    },
    DOGE: {
      ...(dogeFundRes.ok ? diagOf('binance', dogeFundRes.diag, true) : diagOf('binance', dogeFundRes.diag, false)),
      provider: dogeFundRes.ok ? dogeFundRes.data.provider : null,
    },
  };

  if (!btcRes.ok) errors.push(`OKX BTC K 线失败：${btcRes.error}（${btcRes.diag.errorDetail}）`);
  if (!pepeRes.ok) errors.push(`OKX PEPE K 线失败：${pepeRes.error}（${pepeRes.diag.errorDetail}）`);
  if (!dogeRes.ok) errors.push(`OKX DOGE K 线失败：${dogeRes.error}（${dogeRes.diag.errorDetail}）`);
  if (!tickerRes.ok) errors.push(`OKX 最新价失败：${tickerRes.error}（${tickerRes.diag.errorDetail}）`);

  const pepeFunding = pepeFundRes.ok ? pepeFundRes.data.points : [];
  const dogeFunding = dogeFundRes.ok ? dogeFundRes.data.points : [];
  const fundingProvider = pepeFundRes.ok
    ? pepeFundRes.data.provider
    : dogeFundRes.ok
      ? dogeFundRes.data.provider
      : null;
  if (!pepeFundRes.ok) errors.push(`PEPE 资金费率不可用：${pepeFundRes.diag.errorDetail}`);
  if (!dogeFundRes.ok) errors.push(`DOGE 资金费率不可用：${dogeFundRes.diag.errorDetail}`);

  const prices: MarketOverview['prices'] = {
    PEPE: tickerRes.ok ? (tickerRes.data.PEPE ?? null) : null,
    DOGE: tickerRes.ok ? (tickerRes.data.DOGE ?? null) : null,
    BTC: tickerRes.ok ? (tickerRes.data.BTC ?? null) : null,
  };

  const lastConfirmedTs: MarketOverview['lastConfirmedTs'] = {
    PEPE: pepeRes.ok ? pepeRes.data.until : null,
    DOGE: dogeRes.ok ? dogeRes.data.until : null,
    BTC: btcRes.ok ? btcRes.data.until : null,
  };
  const intraday: MarketOverview['intraday'] = {
    PEPE: pepeRes.ok ? pepeRes.data.intradayCandle : null,
    DOGE: dogeRes.ok ? dogeRes.data.intradayCandle : null,
    BTC: btcRes.ok ? btcRes.data.intradayCandle : null,
  };

  const btcBars = btcRes.ok ? btcRes.data.confirmedCandles : [];
  const pepeBars = pepeRes.ok ? pepeRes.data.confirmedCandles : [];
  const dogeBars = dogeRes.ok ? dogeRes.data.confirmedCandles : [];

  const barsOk = (bars: Candle[]) => bars.length >= 20;
  const canAnalyze = barsOk(btcBars) && barsOk(pepeBars) && barsOk(dogeBars);
  if (!canAnalyze) {
    if (btcRes.ok && !barsOk(btcBars)) errors.push(`OKX BTC 已收盘 K 线不足 20 根（${btcBars.length}）`);
    if (pepeRes.ok && !barsOk(pepeBars)) errors.push(`OKX PEPE 已收盘 K 线不足 20 根（${pepeBars.length}）`);
    if (dogeRes.ok && !barsOk(dogeBars)) errors.push(`OKX DOGE 已收盘 K 线不足 20 根（${dogeBars.length}）`);
  }

  let btc: BtcEnv = {
    symbol: 'BTC-USDT-SWAP',
    price: prices.BTC?.last ?? null,
    priceTs: prices.BTC?.ts ?? null,
    return7dPct: null,
    maxDrawdown24hPct: null,
    closeAboveEma100: null,
    hardBreakdown: false,
    trend: 'unknown',
    source: prices.BTC ? 'okx' : 'unavailable',
  };
  let pepe: AssetSignal | null = null;
  let doge: AssetSignal | null = null;

  if (canAnalyze) {
    // ratio-based 相对强度互馈（统一时间口径）
    const pepeRel = relativeReturn(pepeBars, btcBars, DEFAULT_CONFIG.thresholds.relativeStrengthWindow);
    const dogeRel = relativeReturn(dogeBars, btcBars, DEFAULT_CONFIG.thresholds.relativeStrengthWindow);

    pepe = analyzeAssetV2(
      'PEPE',
      pepeBars,
      pepeRes.ok ? pepeRes.data.intradayCandle : null,
      btcBars,
      pepeFunding,
      { peerRelativeStrengthPct: dogeRel },
    );
    doge = analyzeAssetV2(
      'DOGE',
      dogeBars,
      dogeRes.ok ? dogeRes.data.intradayCandle : null,
      btcBars,
      dogeFunding,
      { peerRelativeStrengthPct: pepeRel },
    );

    const btcFields = computeBtcEnvironment(btcBars, DEFAULT_CONFIG.thresholds);
    btc = {
      symbol: 'BTC-USDT-SWAP',
      price: prices.BTC?.last ?? null,
      priceTs: prices.BTC?.ts ?? null,
      return7dPct: btcFields.return7dPct,
      maxDrawdown24hPct: btcFields.maxDrawdown24hPct,
      closeAboveEma100: btcFields.closeAboveEma100,
      hardBreakdown: btcFields.hardBreakdown,
      trend: btcFields.trend,
      source: 'okx',
    };
  }

  const confirmedTsList = Object.values(lastConfirmedTs).filter((v): v is number => v != null);
  const okxOk = btcRes.ok && pepeRes.ok && dogeRes.ok;
  const status: MarketOverview['status'] = !okxOk || !canAnalyze ? 'unavailable' : 'live';

  // P0-1/P0-3：三态新鲜度 + funding 末点 ts（加性字段，不改变 live/unavailable 判定）。
  const fundingTs: MarketOverview['fundingTs'] = {
    PEPE: pepeFunding.length ? pepeFunding[pepeFunding.length - 1].ts : null,
    DOGE: dogeFunding.length ? dogeFunding[dogeFunding.length - 1].ts : null,
  };
  const freshness = deriveOverviewFreshness({
    okxOk,
    canAnalyze,
    lastConfirmedTs,
    priceTs: {
      PEPE: prices.PEPE?.ts ?? null,
      DOGE: prices.DOGE?.ts ?? null,
      BTC: prices.BTC?.ts ?? null,
    },
    now: generatedAt,
  });

  return {
    status,
    generatedAt,
    error: errors[0] ?? undefined,
    errors,
    btc,
    pepe,
    doge,
    lastCandleTs: confirmedTsList.length ? Math.min(...confirmedTsList) : null,
    lastConfirmedTs,
    intraday,
    prices,
    sources: { okxCandles: candleDiag, okxTickers: tickerDiag, funding: fundingDiag },
    fundingProvider,
    freshness,
    fundingTs,
  };
}

export function btcRiskLabel(btc: BtcEnv): string {
  if (btc.maxDrawdown24hPct == null) return '数据不可用';
  if (btc.hardBreakdown) return '环境风险：BTC 硬破位';
  if (btc.closeAboveEma100 === false) return '环境偏弱：BTC 跌破 EMA100';
  if (btc.trend === 'up') return '环境偏暖：BTC 上行';
  return '环境中性：BTC 区间震荡';
}

export function envSummary(btc: BtcEnv, pepe: AssetSignal | null, doge: AssetSignal | null): string {
  const risk = btcRiskLabel(btc);
  const stateOf = (s: AssetSignal | null) => (s ? `${s.stateLabel}` : '—');
  return `${risk}；PEPE ${stateOf(pepe)}，DOGE ${stateOf(doge)}；BTC 24h 回撤 ${fmt(btc.maxDrawdown24hPct)}`;
}

export { EMPTY_DIAG };
