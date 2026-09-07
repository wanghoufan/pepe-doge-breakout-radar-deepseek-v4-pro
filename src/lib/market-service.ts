/**
 * 市场概览编排（仅服务端）。拉取 BTC / PEPE / DOGE 三方数据，
 * 计算相对强度互馈，再对 PEPE、DOGE 分别跑实时雷达引擎。
 *
 * 降级口径（关键）：
 * - OKX（价格 + K 线）与 Binance（资金费率）**完全独立**请求、独立判定成败。
 *   Binance 失败时，OKX 的实时价格与 K 线照常生效，整体状态仍为 live。
 * - 判定突破只吃「已收盘」的 4H K 线；盘中未收盘那根只作为展示用的 intraday 数据。
 * - 任何失败都产出结构化诊断，绝不用历史快照或模拟值冒充实时行情。
 */
import { analyzeAsset, computeFeatures } from './analysis';
import { DEFAULT_CONFIG } from './config';
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
  source: 'okx' | 'unavailable';
}

export interface FundingDiag extends Omit<SourceDiag, 'provider'> {
  provider: 'binance' | 'okx' | null;
}

export interface MarketOverview {
  status: 'live' | 'partial' | 'unavailable';
  generatedAt: number;
  error?: string;
  errors: string[];
  btc: BtcEnv;
  pepe: AssetSignal | null;
  doge: AssetSignal | null;
  /** 最后一根已收盘 K 线时间（判定口径）。 */
  lastCandleTs: number | null;
  /** 各标的最后一根已收盘 K 线时间。 */
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
  /** 各标的盘中未收盘 K 线（仅展示，不参与判定）。 */
  intraday: { PEPE: Candle | null; DOGE: Candle | null; BTC: Candle | null };
  /** 实时价格与时间戳。 */
  prices: Record<'PEPE' | 'DOGE' | 'BTC', { last: number; ts: number } | null>;
  /** 逐数据源诊断，供 /api/market/health 与页面排障。 */
  sources: {
    okxCandles: Record<'PEPE' | 'DOGE' | 'BTC', SourceDiag>;
    okxTickers: SourceDiag;
    funding: Record<'PEPE' | 'DOGE', FundingDiag>;
  };
  fundingProvider: 'binance' | 'okx' | null;
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

  // 资金费率是独立维度：失败只标记降级，不影响价格与 K 线可用性。
  const pepeFunding = pepeFundRes.ok ? pepeFundRes.data.points : [];
  const dogeFunding = dogeFundRes.ok ? dogeFundRes.data.points : [];
  const fundingProvider = pepeFundRes.ok
    ? pepeFundRes.data.provider
    : dogeFundRes.ok
      ? dogeFundRes.data.provider
      : null;
  if (!pepeFundRes.ok) errors.push(`PEPE 资金费率不可用（Binance 与 OKX 均失败）：${pepeFundRes.diag.errorDetail}`);
  if (!dogeFundRes.ok) errors.push(`DOGE 资金费率不可用（Binance 与 OKX 均失败）：${dogeFundRes.diag.errorDetail}`);

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

  // 只用已收盘 K 线跑引擎（未收盘那根不构成突破确认）。
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
    source: prices.BTC ? 'okx' : 'unavailable',
  };
  let pepe: AssetSignal | null = null;
  let doge: AssetSignal | null = null;

  if (canAnalyze) {
    const pepeFeat = computeFeatures(pepeBars, btcBars, pepeFunding, DEFAULT_CONFIG.thresholds);
    const dogeFeat = computeFeatures(dogeBars, btcBars, dogeFunding, DEFAULT_CONFIG.thresholds);

    pepe = analyzeAsset('PEPE', pepeBars, btcBars, pepeFunding, {
      peerRelativeStrengthPct: dogeFeat.feature.relativeStrength,
    });
    doge = analyzeAsset('DOGE', dogeBars, btcBars, dogeFunding, {
      peerRelativeStrengthPct: pepeFeat.feature.relativeStrength,
    });

    const btcRaw = pepeFeat.raw;
    btc = {
      symbol: 'BTC-USDT-SWAP',
      price: prices.BTC?.last ?? null,
      priceTs: prices.BTC?.ts ?? null,
      return7dPct: btcRaw.btcReturnPct,
      maxDrawdown24hPct: btcRaw.btc24hDD,
      closeAboveEma100: btcRaw.btcCloseAboveEma100,
      source: 'okx',
    };
  }

  const confirmedTsList = Object.values(lastConfirmedTs).filter((v): v is number => v != null);
  const okxOk = btcRes.ok && pepeRes.ok && dogeRes.ok;
  const status: MarketOverview['status'] = !okxOk || !canAnalyze ? 'unavailable' : 'live';

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
  };
}

export function btcRiskLabel(btc: BtcEnv): string {
  if (btc.maxDrawdown24hPct == null) return '数据不可用';
  if (btc.maxDrawdown24hPct <= DEFAULT_CONFIG.thresholds.btcMaxDrawdownPct) return '环境风险：BTC 急跌';
  if (btc.closeAboveEma100 === false) return '环境偏弱：BTC 跌破 EMA100';
  if (btc.return7dPct != null && btc.return7dPct > 0) return '环境偏暖：BTC 上行';
  return '环境中性：BTC 区间震荡';
}

export function envSummary(btc: BtcEnv, pepe: AssetSignal | null, doge: AssetSignal | null): string {
  const risk = btcRiskLabel(btc);
  const stateOf = (s: AssetSignal | null) => (s ? `${s.stateLabel}(${s.opportunityScore})` : '—');
  return `${risk}；PEPE ${stateOf(pepe)}，DOGE ${stateOf(doge)}；BTC 24h 回撤 ${fmt(btc.maxDrawdown24hPct)}`;
}

export { EMPTY_DIAG };
