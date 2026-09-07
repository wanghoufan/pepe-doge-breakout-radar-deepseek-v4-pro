/**
 * 数据模型与共享类型定义。
 *
 * 约定：
 * - 时间内部统一使用 UTC 毫秒时间戳（epoch ms）。
 * - 界面默认以 Asia/Shanghai（UTC+8）展示，并明确标注时区。
 * - 所有第三方数据都必须携带 value / source / timestamp / freshness / status。
 */

/** K 线（已完成或进行中）。`confirm` 由数据源决定：completed 表示已收盘。 */
export interface Candle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  /** 成交量（base，单位依交易对而定） */
  vol: number;
  /** 成交额（quote，USDT） */
  quoteVol: number;
  /** 是否已收盘确认 */
  confirmed: boolean;
}

export type DataStatus = 'ok' | 'stale' | 'missing' | 'error' | 'degraded';
export type Freshness = 'fresh' | 'stale' | 'unknown';

/** 任意指标点的统一包裹：始终携带来源与时间信息。 */
export interface DataPoint<T> {
  value: T | null;
  source: string;
  timestamp: number | null;
  freshness: Freshness;
  status: DataStatus;
  /** 人类可读的补充说明（为什么是这个状态 / 缺失了什么） */
  note?: string;
}

export type AssetId = 'PEPE' | 'DOGE' | 'BTC';

export interface AssetMeta {
  id: AssetId;
  instId: string;
  name: string;
  symbol: string;
  /** 资金费率 Binance 符号（跨交易所参考），仅用于拥挤度方向性判断 */
  fundingBinanceSymbol: string;
  themecolor: string;
}

export type Timeframe = '1H' | '4H' | '1D';

export type StateCode =
  | 'forbidden'
  | 'accumulating'
  | 'near_breakout'
  | 'breakout_confirmed'
  | 'awaiting_pullback'
  | 'invalidated';

export interface KeyLevels {
  /** 结构阻力（此前 7 日最高价） */
  resistance: number | null;
  /** 突破位（等于 resistance，突破后成为观察支撑） */
  breakoutLevel: number | null;
  /** 回踩观察区上沿 */
  pullbackUpper: number | null;
  /** 回踩观察区下沿 */
  pullbackLower: number | null;
  /** 硬失效价 */
  invalidation: number | null;
  /** EMA20 */
  ema20: number | null;
}

export interface ConditionItem {
  key: string;
  label: string;
  met: boolean;
  /** 该条件是否因数据缺失而不可判定（true 表示未知，不能当通过） */
  unknown: boolean;
  detail: string;
  weight?: number;
}

export interface AssetSignal {
  asset: AssetId;
  state: StateCode;
  stateLabel: string;
  opportunityScore: number;
  riskScore: number;
  hardVeto: boolean;
  hardVetoReason: string | null;
  reasons: string[];
  metConditions: ConditionItem[];
  missingConditions: ConditionItem[];
  dataQuality: {
    missingFields: string[];
    staleFields: string[];
    degraded: boolean;
    summary: string;
  };
  keyLevels: KeyLevels;
  features: FeatureVector;
}

export interface FeatureVector {
  /** 最近 3 日 ATR / 前 7 日 ATR（compressionRatio，越小越收缩） */
  compressionRatio: number | null;
  /** 最近 3 日均量 / 前 7 日均量 */
  preVolumeRatio: number | null;
  /** 启动前 7 日收益 % */
  preReturnPct: number | null;
  /** 4H 收盘是否站上此前 7 日最高价 */
  abovePriorHigh: boolean | null;
  /** 突破 K 线量比（相对前 7 日单根 median quoteVol） */
  breakoutVolRatio: number | null;
  /** 启动后 24~48h 均量 / 前 7 日中位量 */
  persistentVolumeRatio: number | null;
  /** 币/BTC 相对强度（价格比，归一化后涨跌幅 %） */
  relativeStrength: number | null;
  /** 价格是否高于 EMA20 */
  aboveEma20: boolean | null;
  /** EMA 多头排列 EMA20>50>100 */
  emaBullishStack: boolean | null;
  /** BTC 同期窗口收益 % */
  btcReturnPct: number | null;
  /** 资金费率平均 %（换算成百分比） */
  fundingAvgPct: number | null;
}