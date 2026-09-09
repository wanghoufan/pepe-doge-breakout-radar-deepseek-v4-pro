/**
 * 市场概览编排（V2，仅服务端）。
 *
 * 拉取 BTC / PEPE / DOGE / ETHFI 四方数据，计算 ratio-based 相对强度互馈，
 * 再对 PEPE、DOGE、ETHFI 分别跑 V2 分层引擎（analyzeAssetV2）。
 * ETHFI 与 PEPE/DOGE 同阈值同权重（零改动）；其 peer 广度取 PEPE/DOGE 均值。
 *
 * 分标隔离（HIGH 修复，不改任何阈值/权重/策略）：
 * - BTC 是共享环境依赖（相对强度与环境闸门必须吃 BTC K 线），BTC 失败仍整体不可分析；
 * - PEPE / DOGE / ETHFI 各自独立判定可分析性（请求成功 + 已收盘 K 线 ≥ 20 根），
 *   任一标故障只降级自身（signal=null + 当标 freshness unavailable），他标不受影响；
 * - 全局 status / freshness 只看核心三方（BTC + PEPE + DOGE），ETHFI 不再纳入全局门控。
 *
 * 降级口径（不变）：
 * - OKX（价格 + K 线）与 Binance（资金费率）完全独立请求、独立判定成败。
 * - 判定突破只吃「已收盘」4H K 线；盘中未收盘那根只作展示 / INTRABAR 提示。
 * - 任何失败都产出结构化诊断，绝不用历史快照或模拟值冒充实时行情。
 */
import { analyzeAssetV2, computeBtcEnvironment } from './v2/engine';
import { DEFAULT_CONFIG } from './config';
import {
  deriveCandleOverviewFreshness,
  deriveCoinFreshness,
  deriveOverviewFreshness,
  type CandleOverviewFreshness,
  type FeedFreshness,
} from './freshness';
import { relativeReturn } from './relative-strength';
import {
  getFunding,
  getOkxCandles,
  getOkxTickers,
  type FetchDiag,
  type FundingResult,
  type OkxCandles,
  type OkxTickers,
  type Result,
} from './market-client';
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
  ethfi: AssetSignal | null;
  lastCandleTs: number | null;
  /**
   * 各币种最后已收盘 K 线 openTs（Phase A：open 语义 = 区间起点，
   * 禁止直解为更新时间；closeTs = openTs + 4H，见 candle 字段）。
   */
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null; ETHFI: number | null };
  intraday: { PEPE: Candle | null; DOGE: Candle | null; BTC: Candle | null; ETHFI: Candle | null };
  prices: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', { last: number; ts: number } | null>;
  sources: {
    okxCandles: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', SourceDiag>;
    okxTickers: SourceDiag;
    funding: Record<'PEPE' | 'DOGE' | 'ETHFI', FundingDiag>;
  };
  fundingProvider: 'binance' | 'okx' | null;
  /** P0-1 三态新鲜度（ok/stale/unavailable）+ 最后有效更新；仅可靠性门控，不参与评分。 */
  freshness: FeedFreshness;
  /** 分标新鲜度（各标的独立门控：任一标故障只降级自身，他标不受影响）。 */
  freshnessByCoin: Record<'PEPE' | 'DOGE' | 'ETHFI', FeedFreshness>;
  /**
   * Phase A K 线新鲜度明细（期望收盘 Bar 对比口径）：
   * current4HOpenTs / expectedLastConfirmedOpenTs(+CloseTs) /
   * perCoin{lastConfirmedOpenTs/CloseTs, candleLagBars} /
   * freshnessStatus(LIVE/STALE/UNAVAILABLE) / staleReason(编码)。
   */
  candle: CandleOverviewFreshness;
  /** P0-3 各币种资金费率末点 ts（无则 null，用于来源新鲜度行）。 */
  fundingTs: Record<'PEPE' | 'DOGE' | 'ETHFI', number | null>;
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

/** buildMarketOverview 输入（8 路独立抓取结果，纯组装无网络，可单测）。 */
export interface MarketFetchResults {
  btc: Result<OkxCandles>;
  pepe: Result<OkxCandles>;
  doge: Result<OkxCandles>;
  ethfi: Result<OkxCandles>;
  tickers: Result<OkxTickers>;
  pepeFunding: Result<FundingResult>;
  dogeFunding: Result<FundingResult>;
  ethfiFunding: Result<FundingResult>;
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const generatedAt = Date.now();

  const [btcRes, pepeRes, dogeRes, ethfiRes, tickerRes, pepeFundRes, dogeFundRes, ethfiFundRes] = await Promise.all([
    getOkxCandles('BTC', '4H', 120),
    getOkxCandles('PEPE', '4H', 120),
    getOkxCandles('DOGE', '4H', 120),
    getOkxCandles('ETHFI', '4H', 120),
    getOkxTickers(['BTC', 'PEPE', 'DOGE', 'ETHFI']),
    getFunding('PEPE', 30),
    getFunding('DOGE', 30),
    getFunding('ETHFI', 30),
  ]);

  return buildMarketOverview(
    {
      btc: btcRes,
      pepe: pepeRes,
      doge: dogeRes,
      ethfi: ethfiRes,
      tickers: tickerRes,
      pepeFunding: pepeFundRes,
      dogeFunding: dogeFundRes,
      ethfiFunding: ethfiFundRes,
    },
    generatedAt,
  );
}

/**
 * 纯组装：把 8 路抓取结果编排成 MarketOverview（分标隔离核心，无网络，可单测）。
 * 阈值/权重/策略零改动，只改门控粒度：全局 status/freshness 只看 BTC+PEPE+DOGE。
 */
export function buildMarketOverview(r: MarketFetchResults, generatedAt: number): MarketOverview {
  const errors: string[] = [];
  const { btc: btcRes, pepe: pepeRes, doge: dogeRes, ethfi: ethfiRes } = r;
  const tickerRes = r.tickers;
  const pepeFundRes = r.pepeFunding;
  const dogeFundRes = r.dogeFunding;
  const ethfiFundRes = r.ethfiFunding;

  const candleDiag: MarketOverview['sources']['okxCandles'] = {
    BTC: btcRes.ok ? diagOf('okx', btcRes.diag, true) : diagOf('okx', btcRes.diag, false),
    PEPE: pepeRes.ok ? diagOf('okx', pepeRes.diag, true) : diagOf('okx', pepeRes.diag, false),
    DOGE: dogeRes.ok ? diagOf('okx', dogeRes.diag, true) : diagOf('okx', dogeRes.diag, false),
    ETHFI: ethfiRes.ok ? diagOf('okx', ethfiRes.diag, true) : diagOf('okx', ethfiRes.diag, false),
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
    ETHFI: {
      ...(ethfiFundRes.ok ? diagOf('binance', ethfiFundRes.diag, true) : diagOf('binance', ethfiFundRes.diag, false)),
      provider: ethfiFundRes.ok ? ethfiFundRes.data.provider : null,
    },
  };

  if (!btcRes.ok) errors.push(`OKX BTC K 线失败：${btcRes.error}（${btcRes.diag.errorDetail}）`);
  if (!pepeRes.ok) errors.push(`OKX PEPE K 线失败：${pepeRes.error}（${pepeRes.diag.errorDetail}）`);
  if (!dogeRes.ok) errors.push(`OKX DOGE K 线失败：${dogeRes.error}（${dogeRes.diag.errorDetail}）`);
  if (!ethfiRes.ok) errors.push(`OKX ETHFI K 线失败：${ethfiRes.error}（${ethfiRes.diag.errorDetail}）`);
  if (!tickerRes.ok) errors.push(`OKX 最新价失败：${tickerRes.error}（${tickerRes.diag.errorDetail}）`);

  const pepeFunding = pepeFundRes.ok ? pepeFundRes.data.points : [];
  const dogeFunding = dogeFundRes.ok ? dogeFundRes.data.points : [];
  const ethfiFunding = ethfiFundRes.ok ? ethfiFundRes.data.points : [];
  const fundingProvider = pepeFundRes.ok
    ? pepeFundRes.data.provider
    : dogeFundRes.ok
      ? dogeFundRes.data.provider
      : ethfiFundRes.ok
        ? ethfiFundRes.data.provider
        : null;
  if (!pepeFundRes.ok) errors.push(`PEPE 资金费率不可用：${pepeFundRes.diag.errorDetail}`);
  if (!dogeFundRes.ok) errors.push(`DOGE 资金费率不可用：${dogeFundRes.diag.errorDetail}`);
  if (!ethfiFundRes.ok) errors.push(`ETHFI 资金费率不可用：${ethfiFundRes.diag.errorDetail}`);

  const prices: MarketOverview['prices'] = {
    PEPE: tickerRes.ok ? (tickerRes.data.PEPE ?? null) : null,
    DOGE: tickerRes.ok ? (tickerRes.data.DOGE ?? null) : null,
    BTC: tickerRes.ok ? (tickerRes.data.BTC ?? null) : null,
    ETHFI: tickerRes.ok ? (tickerRes.data.ETHFI ?? null) : null,
  };

  const lastConfirmedTs: MarketOverview['lastConfirmedTs'] = {
    PEPE: pepeRes.ok ? pepeRes.data.until : null,
    DOGE: dogeRes.ok ? dogeRes.data.until : null,
    BTC: btcRes.ok ? btcRes.data.until : null,
    ETHFI: ethfiRes.ok ? ethfiRes.data.until : null,
  };
  const intraday: MarketOverview['intraday'] = {
    PEPE: pepeRes.ok ? pepeRes.data.intradayCandle : null,
    DOGE: dogeRes.ok ? dogeRes.data.intradayCandle : null,
    BTC: btcRes.ok ? btcRes.data.intradayCandle : null,
    ETHFI: ethfiRes.ok ? ethfiRes.data.intradayCandle : null,
  };

  const btcBars = btcRes.ok ? btcRes.data.confirmedCandles : [];
  const pepeBars = pepeRes.ok ? pepeRes.data.confirmedCandles : [];
  const dogeBars = dogeRes.ok ? dogeRes.data.confirmedCandles : [];
  const ethfiBars = ethfiRes.ok ? ethfiRes.data.confirmedCandles : [];

  const barsOk = (bars: Candle[]) => bars.length >= 20;
  // 分标隔离：BTC 为共享环境依赖（相对强度/环境闸门必须吃 BTC K 线）；
  // PEPE / DOGE / ETHFI 各自独立可分析，任一标故障只降级自身。
  const btcReady = btcRes.ok && barsOk(btcBars);
  const pepeReady = btcReady && pepeRes.ok && barsOk(pepeBars);
  const dogeReady = btcReady && dogeRes.ok && barsOk(dogeBars);
  const ethfiReady = btcReady && ethfiRes.ok && barsOk(ethfiBars);
  if (btcRes.ok && !barsOk(btcBars)) errors.push(`OKX BTC 已收盘 K 线不足 20 根（${btcBars.length}）`);
  if (pepeRes.ok && !barsOk(pepeBars)) errors.push(`OKX PEPE 已收盘 K 线不足 20 根（${pepeBars.length}）`);
  if (dogeRes.ok && !barsOk(dogeBars)) errors.push(`OKX DOGE 已收盘 K 线不足 20 根（${dogeBars.length}）`);
  if (ethfiRes.ok && !barsOk(ethfiBars)) errors.push(`OKX ETHFI 已收盘 K 线不足 20 根（${ethfiBars.length}）`);

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
  let ethfi: AssetSignal | null = null;

  // ratio-based 相对强度互馈（统一时间口径；PEPE↔DOGE 互为 peer 口径不变，ETHFI 取两者均值）。
  // 各对独立计算：某标缺席只影响 peer 均值回退（单边可用值），不阻塞他标分析。
  const rsWindow = DEFAULT_CONFIG.thresholds.relativeStrengthWindow;
  const pepeRel = pepeRes.ok && barsOk(pepeBars) && btcReady ? relativeReturn(pepeBars, btcBars, rsWindow) : null;
  const dogeRel = dogeRes.ok && barsOk(dogeBars) && btcReady ? relativeReturn(dogeBars, btcBars, rsWindow) : null;
  const ethfiPeer = pepeRel != null && dogeRel != null ? (pepeRel + dogeRel) / 2 : (pepeRel ?? dogeRel);

  if (pepeReady) {
    pepe = analyzeAssetV2(
      'PEPE',
      pepeBars,
      pepeRes.ok ? pepeRes.data.intradayCandle : null,
      btcBars,
      pepeFunding,
      { peerRelativeStrengthPct: dogeRel },
    );
  }
  if (dogeReady) {
    doge = analyzeAssetV2(
      'DOGE',
      dogeBars,
      dogeRes.ok ? dogeRes.data.intradayCandle : null,
      btcBars,
      dogeFunding,
      { peerRelativeStrengthPct: pepeRel },
    );
  }
  if (ethfiReady) {
    ethfi = analyzeAssetV2(
      'ETHFI',
      ethfiBars,
      ethfiRes.ok ? ethfiRes.data.intradayCandle : null,
      btcBars,
      ethfiFunding,
      { peerRelativeStrengthPct: ethfiPeer },
    );
  }
  if (btcReady) {
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
  // 全局门控只看核心三方（BTC 环境 + PEPE + DOGE）：ETHFI 不再纳入全局门控，故障只降级自身。
  const coreCandlesOk = btcRes.ok && pepeRes.ok && dogeRes.ok;
  const coreReady = btcReady && pepeReady && dogeReady;
  const status: MarketOverview['status'] = !coreCandlesOk || !coreReady ? 'unavailable' : 'live';

  // P0-1/P0-3：三态新鲜度 + funding 末点 ts（加性字段，不改变 live/unavailable 判定）。
  const fundingTs: MarketOverview['fundingTs'] = {
    PEPE: pepeFunding.length ? pepeFunding[pepeFunding.length - 1].ts : null,
    DOGE: dogeFunding.length ? dogeFunding[dogeFunding.length - 1].ts : null,
    ETHFI: ethfiFunding.length ? ethfiFunding[ethfiFunding.length - 1].ts : null,
  };
  // 全局 freshness 只吃核心三方键（ETHFI 缺席走旧三币口径，不再恒传 ETHFI 键拖垮全局）。
  const freshness = deriveOverviewFreshness({
    okxOk: coreCandlesOk,
    canAnalyze: coreReady,
    lastConfirmedTs: { PEPE: lastConfirmedTs.PEPE, DOGE: lastConfirmedTs.DOGE, BTC: lastConfirmedTs.BTC },
    priceTs: {
      PEPE: prices.PEPE?.ts ?? null,
      DOGE: prices.DOGE?.ts ?? null,
      BTC: prices.BTC?.ts ?? null,
    },
    now: generatedAt,
  });
  // 分标新鲜度：各标独立门控，任一标故障只降级自身。
  const freshnessByCoin: MarketOverview['freshnessByCoin'] = {
    PEPE: deriveCoinFreshness({
      ok: pepeRes.ok,
      ready: pepeReady,
      lastConfirmedTs: lastConfirmedTs.PEPE,
      priceTs: prices.PEPE?.ts ?? null,
      now: generatedAt,
    }),
    DOGE: deriveCoinFreshness({
      ok: dogeRes.ok,
      ready: dogeReady,
      lastConfirmedTs: lastConfirmedTs.DOGE,
      priceTs: prices.DOGE?.ts ?? null,
      now: generatedAt,
    }),
    ETHFI: deriveCoinFreshness({
      ok: ethfiRes.ok,
      ready: ethfiReady,
      lastConfirmedTs: lastConfirmedTs.ETHFI,
      priceTs: prices.ETHFI?.ts ?? null,
      now: generatedAt,
    }),
  };
  // Phase A：K 线期望收盘 Bar 对比明细（与 freshness 同输入，供 API/UI 共用）。
  const candle = deriveCandleOverviewFreshness(lastConfirmedTs, generatedAt);

  return {
    status,
    generatedAt,
    error: errors[0] ?? undefined,
    errors,
    btc,
    pepe,
    doge,
    ethfi,
    lastCandleTs: confirmedTsList.length ? Math.min(...confirmedTsList) : null,
    lastConfirmedTs,
    intraday,
    prices,
    sources: { okxCandles: candleDiag, okxTickers: tickerDiag, funding: fundingDiag },
    fundingProvider,
    freshness,
    freshnessByCoin,
    fundingTs,
    candle,
  };
}

export function btcRiskLabel(btc: BtcEnv): string {
  if (btc.maxDrawdown24hPct == null) return '数据不可用';
  if (btc.hardBreakdown) return '环境风险：BTC 硬破位';
  if (btc.closeAboveEma100 === false) return '环境偏弱：BTC 跌破 EMA100';
  if (btc.trend === 'up') return '环境偏暖：BTC 上行';
  return '环境中性：BTC 区间震荡';
}

export function envSummary(btc: BtcEnv, pepe: AssetSignal | null, doge: AssetSignal | null, ethfi?: AssetSignal | null): string {
  const risk = btcRiskLabel(btc);
  const stateOf = (s: AssetSignal | null | undefined) => (s ? `${s.stateLabel}` : '—');
  return `${risk}；PEPE ${stateOf(pepe)}，DOGE ${stateOf(doge)}，ETHFI ${stateOf(ethfi)}；BTC 24h 回撤 ${fmt(btc.maxDrawdown24hPct)}`;
}

export { EMPTY_DIAG };
