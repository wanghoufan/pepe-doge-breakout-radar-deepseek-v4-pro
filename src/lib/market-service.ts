/**
 * 市场概览编排（仅服务端）。拉取 BTC / PEPE / DOGE 三方数据，
 * 计算相对强度互馈，再对 PEPE、DOGE 分别跑实时雷达引擎。
 *
 * 任一第三方接口不可达时整体降级为 `status: "unavailable"`，
 * 但绝不抛异常让页面白屏；历史模式（B 类证据）不依赖本模块。
 */
import { analyzeAsset, computeFeatures } from './analysis';
import { DEFAULT_CONFIG } from './config';
import { getBinanceFunding, getOkxCandles, getOkxTickers } from './market-client';
import type { AssetSignal } from './types';

export interface BtcEnv {
  symbol: string;
  price: number | null;
  priceTs: number | null;
  return7dPct: number | null;
  maxDrawdown24hPct: number | null;
  closeAboveEma100: boolean | null;
  source: 'okx' | 'unavailable';
}

export interface MarketOverview {
  status: 'live' | 'unavailable';
  generatedAt: number;
  error?: string;
  btc: BtcEnv;
  pepe: AssetSignal | null;
  doge: AssetSignal | null;
  /** 数据新鲜度：最后一根收盘 K 线时间 */
  lastCandleTs: number | null;
}

const fmt = (v: number | null) => (v == null ? '—' : `${v.toFixed(2)}%`);

export async function getMarketOverview(): Promise<MarketOverview> {
  const generatedAt = Date.now();
  try {
    const [btcCandles, pepeCandles, dogeCandles, tickers, pepeFunding, dogeFunding] =
      await Promise.all([
        getOkxCandles('BTC', '4H', 120),
        getOkxCandles('PEPE', '4H', 120),
        getOkxCandles('DOGE', '4H', 120),
        getOkxTickers(['BTC', 'PEPE', 'DOGE']),
        getBinanceFunding('PEPE', 30),
        getBinanceFunding('DOGE', 30),
      ]);

    const btcBars = btcCandles.candles;
    const pepeBars = pepeCandles.candles;
    const dogeBars = dogeCandles.candles;

    if (btcBars.length < 20 || pepeBars.length < 20 || dogeBars.length < 20) {
      throw new Error('insufficient_bars');
    }

    // 互馈相对强度：先算各自 relativeStrength，再交给引擎做板块广度/共振
    const pepeFeat = computeFeatures(pepeBars, btcBars, pepeFunding, DEFAULT_CONFIG.thresholds);
    const dogeFeat = computeFeatures(dogeBars, btcBars, dogeFunding, DEFAULT_CONFIG.thresholds);

    const pepe = analyzeAsset('PEPE', pepeBars, btcBars, pepeFunding, {
      peerRelativeStrengthPct: dogeFeat.feature.relativeStrength,
    });
    const doge = analyzeAsset('DOGE', dogeBars, btcBars, dogeFunding, {
      peerRelativeStrengthPct: pepeFeat.feature.relativeStrength,
    });

    const btcRaw = pepeFeat.raw;
    const btcTick = tickers.BTC;

    const btc: BtcEnv = {
      symbol: 'BTC-USDT',
      price: btcTick?.last ?? null,
      priceTs: btcTick?.ts ?? null,
      return7dPct: btcRaw.btcReturnPct,
      maxDrawdown24hPct: btcRaw.btc24hDD,
      closeAboveEma100: btcRaw.btcCloseAboveEma100,
      source: 'okx',
    };

    const untils = [btcCandles.until, pepeCandles.until, dogeCandles.until].filter(
      (v): v is number => v != null,
    );

    return {
      status: 'live',
      generatedAt,
      btc,
      pepe,
      doge,
      lastCandleTs: untils.length ? Math.min(...untils) : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    return {
      status: 'unavailable',
      generatedAt,
      error: message,
      btc: {
        symbol: 'BTC-USDT',
        price: null,
        priceTs: null,
        return7dPct: null,
        maxDrawdown24hPct: null,
        closeAboveEma100: null,
        source: 'unavailable',
      },
      pepe: null,
      doge: null,
      lastCandleTs: null,
    };
  }
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