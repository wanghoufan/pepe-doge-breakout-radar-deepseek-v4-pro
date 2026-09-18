/**
 * 市场概览编排（V2，仅服务端）。
 *
 * 拉取「已启用注册表标的（getEnabledAssets）＋ BTC 环境参照」的数据，
 * 计算 ratio-based 相对强度互馈，再对各信号标的分别跑 V2 分层引擎（analyzeAssetV2）。
 * 拉取集合由注册表派生（去重 instId），不再硬编码 PEPE/DOGE/ETHFI；
 * 当前 enabled 恰为三币，输出与旧三币口径一致。
 *
 * 分标隔离（HIGH 修复，不改任何阈值/权重/策略）：
 * - BTC 是共享环境依赖（相对强度与环境闸门必须吃 BTC K 线），BTC 失败仍整体不可分析；
 * - 各信号标的独立判定可分析性（请求成功 + 已收盘 K 线 ≥ 20 根），
 *   任一标故障只降级自身（signal=null + 当标 freshness unavailable），他标不受影响；
 * - 全局 status / freshness 只看核心三方（BTC + PEPE + DOGE），其余标的不纳入全局门控。
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
import { getEnabledAssets, getReferenceAssets, getSeedRegistry, type RegistryAsset } from './registry';
import {
  getFundingByInst,
  getOkxCandlesByInst,
  getOkxTickersByInst,
  type FetchDiag,
  type FundingResult,
  type OkxCandles,
  type Result,
} from './market-client';
import type { AssetId, AssetSignal, Candle } from './types';

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

/** 最新价映射（键 = 标的 id）。 */
export type TickerMap = Record<string, { last: number; ts: number }>;

export interface MarketOverview {
  status: 'live' | 'unavailable';
  generatedAt: number;
  error?: string;
  errors: string[];
  btc: BtcEnv;
  /** 以标的 id 为键的动态信号映射（观察盘消费）。 */
  signals: Record<string, AssetSignal | null>;
  /** legacy 便利字段（旧消费方：LiveRadar / AssetDetail / similarity），值取自 signals。 */
  pepe: AssetSignal | null;
  doge: AssetSignal | null;
  ethfi: AssetSignal | null;
  lastCandleTs: number | null;
  /**
   * 各标的最后已收盘 K 线 openTs（Phase A：open 语义 = 区间起点，
   * 禁止直解为更新时间；closeTs = openTs + 4H，见 candle 字段）。
   */
  lastConfirmedTs: Record<string, number | null>;
  intraday: Record<string, Candle | null>;
  prices: Record<string, { last: number; ts: number } | null>;
  sources: {
    okxCandles: Record<string, SourceDiag>;
    okxTickers: SourceDiag;
    funding: Record<string, FundingDiag>;
  };
  fundingProvider: 'binance' | 'okx' | null;
  /** P0-1 三态新鲜度（ok/stale/unavailable）+ 最后有效更新；仅可靠性门控，不参与评分。 */
  freshness: FeedFreshness;
  /** 分标新鲜度（各标的独立门控：任一标故障只降级自身，他标不受影响）。 */
  freshnessByCoin: Record<string, FeedFreshness>;
  /**
   * Phase A K 线新鲜度明细（期望收盘 Bar 对比口径）：
   * current4HOpenTs / expectedLastConfirmedOpenTs(+CloseTs) /
   * perCoin{lastConfirmedOpenTs/CloseTs, candleLagBars} /
   * freshnessStatus(LIVE/STALE/UNAVAILABLE) / staleReason(编码)。
   */
  candle: CandleOverviewFreshness;
  /** P0-3 各信号标的资金费率末点 ts（无则 null，用于来源新鲜度行）。 */
  fundingTs: Record<string, number | null>;
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

/** 注册表未提供抓取结果时的诚实失败（不编造，错误可追溯）。 */
function missingCandleResult(id: string): Result<OkxCandles> {
  const diag: FetchDiag = {
    url: '',
    host: '',
    httpStatus: null,
    vendorCode: null,
    vendorMsg: null,
    errorKind: 'network',
    errorDetail: `注册表未提供 ${id} 的 K 线抓取结果`,
    cached: false,
    durationMs: 0,
    attempts: [],
  };
  return { ok: false, error: 'okx_candles_missing', diag };
}

/** buildMarketOverview 输入（按注册表动态键控的独立抓取结果，纯组装无网络，可单测）。 */
export interface MarketFetchResults {
  /** 参与本轮编排的标的（reference 参照 + enabled 信号标的），决定动态键集合。 */
  assets: RegistryAsset[];
  /** 各标的 K 线，键 = asset.id。 */
  candles: Record<string, Result<OkxCandles>>;
  /** 最新价（一次请求覆盖所有标的 instId），键 = asset.id。 */
  tickers: Result<TickerMap>;
  /** 各信号标的资金费率，键 = asset.id。 */
  funding: Record<string, Result<FundingResult>>;
}

/** 全局门控核心三方（BTC 环境 + PEPE + DOGE）；其余标的不拖垮全局。 */
const CORE_IDS = ['BTC', 'PEPE', 'DOGE'] as const;

export async function getMarketOverview(registry: RegistryAsset[] = getSeedRegistry()): Promise<MarketOverview> {
  const generatedAt = Date.now();

  // 动态拉取集合 = BTC 参照 + 已启用信号标的；按 instId 去重（限频/缓存由 market-client 承担）。
  const assets = [...getReferenceAssets(registry), ...getEnabledAssets(registry)];
  const uniqueInstIds = [...new Set(assets.map((a) => a.instId))];
  const signalAssets = assets.filter((a) => a.role === 'signal');

  const [tickerRes, ...candleResults] = await Promise.all([
    getOkxTickersByInst(uniqueInstIds),
    ...uniqueInstIds.map((instId) => getOkxCandlesByInst(instId, '4H', 120)),
  ]);
  const candleByInst = new Map<string, Result<OkxCandles>>();
  uniqueInstIds.forEach((instId, i) => candleByInst.set(instId, candleResults[i]!));

  const fundingResults = await Promise.all(
    signalAssets.map((a) => getFundingByInst(a.instId, a.fundingBinanceSymbol, 30)),
  );

  const candles: Record<string, Result<OkxCandles>> = {};
  for (const a of assets) candles[a.id] = candleByInst.get(a.instId) ?? missingCandleResult(a.id);

  // instId 键控的最新价回映射为 asset.id 键控（同一 instId 多标的共享同一价）。
  const tickers: Result<TickerMap> = tickerRes.ok
    ? (() => {
        const data: TickerMap = {};
        for (const a of assets) {
          const t = tickerRes.data[a.instId];
          if (t) data[a.id] = t;
        }
        return { ok: true, data, diag: tickerRes.diag };
      })()
    : tickerRes;

  const funding: Record<string, Result<FundingResult>> = {};
  signalAssets.forEach((a, i) => {
    funding[a.id] = fundingResults[i]!;
  });

  return buildMarketOverview({ assets, candles, tickers, funding }, generatedAt);
}

/**
 * 纯组装：把按注册表键控的抓取结果编排成 MarketOverview（分标隔离核心，无网络，可单测）。
 * 阈值/权重/策略零改动，只改门控粒度：全局 status/freshness 只看 BTC+PEPE+DOGE。
 */
export function buildMarketOverview(r: MarketFetchResults, generatedAt: number): MarketOverview {
  const errors: string[] = [];
  const assets = r.assets;
  const signalAssets = assets.filter((a) => a.role === 'signal' && a.status === 'enabled');
  const btcAssetId = assets.find((a) => a.role === 'reference')?.id ?? 'BTC';
  const btcInstId = assets.find((a) => a.id === btcAssetId)?.instId ?? 'BTC-USDT-SWAP';
  const btcRes = r.candles[btcAssetId] ?? missingCandleResult(btcAssetId);

  const candleResOf = (id: string): Result<OkxCandles> => r.candles[id] ?? missingCandleResult(id);
  const barsOf = (id: string): Candle[] => {
    const res = candleResOf(id);
    return res.ok ? res.data.confirmedCandles : [];
  };
  const fundingPointsOf = (id: string) => {
    const fr = r.funding[id];
    return fr?.ok ? fr.data.points : [];
  };

  const candleDiag: Record<string, SourceDiag> = {};
  for (const a of assets) {
    const res = candleResOf(a.id);
    candleDiag[a.id] = diagOf('okx', res.diag, res.ok);
  }
  const tickerDiag = diagOf('okx', r.tickers.diag, r.tickers.ok);
  const fundingDiag: Record<string, FundingDiag> = {};
  for (const a of signalAssets) {
    const fr = r.funding[a.id];
    fundingDiag[a.id] = fr
      ? {
          ...(fr.ok ? diagOf('binance', fr.diag, true) : diagOf('binance', fr.diag, false)),
          provider: fr.ok ? fr.data.provider : null,
        }
      : { ...EMPTY_DIAG('binance'), provider: null };
  }

  for (const a of assets) {
    const res = candleResOf(a.id);
    if (!res.ok) errors.push(`OKX ${a.id} K 线失败：${res.error}（${res.diag.errorDetail}）`);
  }
  if (!r.tickers.ok) errors.push(`OKX 最新价失败：${r.tickers.error}（${r.tickers.diag.errorDetail}）`);

  let fundingProvider: 'binance' | 'okx' | null = null;
  for (const a of signalAssets) {
    const fr = r.funding[a.id];
    if (fr?.ok) {
      fundingProvider = fr.data.provider;
      break;
    }
  }
  for (const a of signalAssets) {
    const fr = r.funding[a.id];
    if (!fr || !fr.ok) errors.push(`${a.id} 资金费率不可用：${fr ? fr.diag.errorDetail : '未拉取'}`);
  }

  const prices: Record<string, { last: number; ts: number } | null> = {};
  const lastConfirmedTs: Record<string, number | null> = {};
  const intraday: Record<string, Candle | null> = {};
  for (const a of assets) {
    prices[a.id] = r.tickers.ok ? (r.tickers.data[a.id] ?? null) : null;
    const res = candleResOf(a.id);
    lastConfirmedTs[a.id] = res.ok ? res.data.until : null;
    intraday[a.id] = res.ok ? res.data.intradayCandle : null;
  }

  const btcBars = barsOf(btcAssetId);
  const barsOk = (bars: Candle[]) => bars.length >= 20;
  // 分标隔离：BTC 为共享环境依赖（相对强度/环境闸门必须吃 BTC K 线）；
  // 各信号标的独立可分析，任一标故障只降级自身。
  const btcReady = btcRes.ok && barsOk(btcBars);
  const readyById: Record<string, boolean> = {};
  for (const a of signalAssets) {
    const res = candleResOf(a.id);
    readyById[a.id] = btcReady && res.ok && barsOk(res.ok ? res.data.confirmedCandles : []);
  }
  for (const a of assets) {
    const res = candleResOf(a.id);
    if (res.ok && !barsOk(res.data.confirmedCandles)) {
      errors.push(`OKX ${a.id} 已收盘 K 线不足 20 根（${res.data.confirmedCandles.length}）`);
    }
  }

  let btc: BtcEnv = {
    symbol: btcInstId,
    price: prices[btcAssetId]?.last ?? null,
    priceTs: prices[btcAssetId]?.ts ?? null,
    return7dPct: null,
    maxDrawdown24hPct: null,
    closeAboveEma100: null,
    hardBreakdown: false,
    trend: 'unknown',
    source: prices[btcAssetId] ? 'okx' : 'unavailable',
  };
  if (btcReady) {
    const btcFields = computeBtcEnvironment(btcBars, DEFAULT_CONFIG.thresholds);
    btc = {
      symbol: btcInstId,
      price: prices[btcAssetId]?.last ?? null,
      priceTs: prices[btcAssetId]?.ts ?? null,
      return7dPct: btcFields.return7dPct,
      maxDrawdown24hPct: btcFields.maxDrawdown24hPct,
      closeAboveEma100: btcFields.closeAboveEma100,
      hardBreakdown: btcFields.hardBreakdown,
      trend: btcFields.trend,
      source: 'okx',
    };
  }

  // ratio-based 相对强度互馈（统一时间口径；PEPE↔DOGE 互为 peer 口径不变，
  // 其余标的取两者均值，与 ETHFI 既有口径一致）。各对独立计算：某标缺席只影响 peer 回退。
  const rsWindow = DEFAULT_CONFIG.thresholds.relativeStrengthWindow;
  const relById: Record<string, number | null> = {};
  for (const a of signalAssets) {
    const res = candleResOf(a.id);
    const bars = res.ok ? res.data.confirmedCandles : [];
    relById[a.id] = res.ok && barsOk(bars) && btcReady ? relativeReturn(bars, btcBars, rsWindow) : null;
  }
  const pepeRel = relById.PEPE ?? null;
  const dogeRel = relById.DOGE ?? null;
  const peerBase = pepeRel != null && dogeRel != null ? (pepeRel + dogeRel) / 2 : (pepeRel ?? dogeRel);
  const peerFor = (id: string): number | null => {
    if (id === 'PEPE') return dogeRel;
    if (id === 'DOGE') return pepeRel;
    return peerBase;
  };

  const signals: Record<string, AssetSignal | null> = {};
  for (const a of signalAssets) {
    const res = candleResOf(a.id);
    const bars = res.ok ? res.data.confirmedCandles : [];
    signals[a.id] =
      readyById[a.id] && res.ok
        ? analyzeAssetV2(a.id as AssetId, bars, res.data.intradayCandle, btcBars, fundingPointsOf(a.id), {
            peerRelativeStrengthPct: peerFor(a.id),
          })
        : null;
  }

  const confirmedTsList = Object.values(lastConfirmedTs).filter((v): v is number => v != null);
  // 全局门控只看核心三方（BTC 环境 + PEPE + DOGE）：其余标的不纳入全局门控，故障只降级自身。
  const coreCandlesOk = CORE_IDS.every((id) => candleResOf(id).ok);
  const coreReady = btcReady && readyById.PEPE === true && readyById.DOGE === true;
  const status: MarketOverview['status'] = !coreCandlesOk || !coreReady ? 'unavailable' : 'live';

  // P0-1/P0-3：三态新鲜度 + funding 末点 ts（加性字段，不改变 live/unavailable 判定）。
  const fundingTs: Record<string, number | null> = {};
  for (const a of signalAssets) {
    const pts = fundingPointsOf(a.id);
    fundingTs[a.id] = pts.length ? pts[pts.length - 1]!.ts : null;
  }
  // 全局 freshness 只吃核心三方键（其余标的缺席走旧三币口径，不再恒传拖垮全局）。
  const freshness = deriveOverviewFreshness({
    okxOk: coreCandlesOk,
    canAnalyze: coreReady,
    lastConfirmedTs: {
      PEPE: lastConfirmedTs.PEPE ?? null,
      DOGE: lastConfirmedTs.DOGE ?? null,
      BTC: lastConfirmedTs.BTC ?? null,
    },
    priceTs: {
      PEPE: prices.PEPE?.ts ?? null,
      DOGE: prices.DOGE?.ts ?? null,
      BTC: prices.BTC?.ts ?? null,
    },
    now: generatedAt,
  });
  // 分标新鲜度：各标独立门控，任一标故障只降级自身。
  const freshnessByCoin: Record<string, FeedFreshness> = {};
  for (const a of signalAssets) {
    const res = candleResOf(a.id);
    freshnessByCoin[a.id] = deriveCoinFreshness({
      ok: res.ok,
      ready: readyById[a.id] === true,
      lastConfirmedTs: lastConfirmedTs[a.id] ?? null,
      priceTs: prices[a.id]?.ts ?? null,
      now: generatedAt,
    });
  }
  // Phase A：K 线期望收盘 Bar 对比明细（与 freshness 同输入，供 API/UI 共用）。
  const candle = deriveCandleOverviewFreshness(
    {
      PEPE: lastConfirmedTs.PEPE ?? null,
      DOGE: lastConfirmedTs.DOGE ?? null,
      BTC: lastConfirmedTs.BTC ?? null,
      ETHFI: lastConfirmedTs.ETHFI ?? null,
    },
    generatedAt,
  );

  return {
    status,
    generatedAt,
    error: errors[0] ?? undefined,
    errors,
    btc,
    signals,
    pepe: signals.PEPE ?? null,
    doge: signals.DOGE ?? null,
    ethfi: signals.ETHFI ?? null,
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
