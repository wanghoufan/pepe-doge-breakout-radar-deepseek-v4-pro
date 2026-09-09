/**
 * 数据模型与共享类型定义（V2）。
 *
 * 约定：
 * - 时间内部统一使用 UTC 毫秒时间戳（epoch ms）。
 * - 界面默认以 Asia/Shanghai（UTC+8）展示，并明确标注时区。
 * - 所有第三方数据都必须携带 value / source / timestamp / freshness / status。
 * - 评分拆分为独立层：Environment / Setup / Trigger / Follow-through / Risk / Hard Veto。
 * - 数据缺失用显式状态表示（COMPUTED / WAITING / PENDING / NOT_STARTED / DATA_UNAVAILABLE），
 *   绝不把「无数据」当成 score = 0。
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
  note?: string;
}

export type AssetId = 'PEPE' | 'DOGE' | 'BTC' | 'ETHFI';

export interface AssetMeta {
  id: AssetId;
  instId: string;
  name: string;
  symbol: string;
  fundingBinanceSymbol: string;
  themecolor: string;
}

export type Timeframe = '1H' | '4H' | '1D';

/* ------------------------------------------------------------------ */
/* 环境闸门                                                             */
/* ------------------------------------------------------------------ */

/** Environment Gate：整体市场是否允许关注山寨币突破。 */
export type EnvironmentGate = 'ALLOW' | 'CAUTION' | 'BLOCK';

/* ------------------------------------------------------------------ */
/* 硬否决                                                               */
/* ------------------------------------------------------------------ */

export type HardVetoKind = 'NONE' | 'BTC_VETO' | 'STRUCTURE_VETO' | 'DATA_VETO' | 'LIQUIDITY_VETO';

/* ------------------------------------------------------------------ */
/* 状态机（10 态）                                                      */
/* ------------------------------------------------------------------ */

export type StateCode =
  | 'MARKET_BLOCKED'
  | 'NO_SETUP'
  | 'BUILDING_SETUP'
  | 'NEAR_BREAKOUT'
  | 'BREAKOUT_CONFIRMED'
  | 'FOLLOW_THROUGH_PENDING'
  | 'HEALTHY_BREAKOUT'
  | 'RETESTING'
  | 'FAILED_BREAKOUT'
  | 'INVALIDATED';

/* ------------------------------------------------------------------ */
/* 分数状态（区分 null / pending / unavailable）                       */
/* ------------------------------------------------------------------ */

/**
 * COMPUTED  : 有数据，value ∈ [0,100]。
 * WAITING    : 前提尚未发生（如 Trigger 在突破前 = WAITING FOR TRIGGER）。
 * PENDING    : 已发生但数据尚未攒够（如突破 < 24h 的 Follow-through）。
 * NOT_STARTED: 阶段未开始（如突破前 Follow-through = NOT_STARTED）。
 * DATA_UNAVAILABLE : API 拉取失败 / 数据缺失。
 */
export type ScoreStatus = 'COMPUTED' | 'WAITING' | 'PENDING' | 'NOT_STARTED' | 'DATA_UNAVAILABLE';

export interface LayeredScore {
  value: number | null;
  status: ScoreStatus;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* 突破信息                                                             */
/* ------------------------------------------------------------------ */

export interface BreakoutInfo {
  /** 突破 K 线的 open ts（breakoutTs）。 */
  ts: number | null;
  /** 突破位（rollingHigh，此前 N 根最高价）。 */
  level: number | null;
  /** 突破 K 线收盘价（breakoutClose）。 */
  close: number | null;
  /** (close / level - 1) * 100。 */
  distancePct: number | null;
  /** 突破 K 线量比（quoteVol / 此前 N 根中位数）。 */
  volumeRatio: number | null;
  /** 是否已在已收盘 K 线上确认（close > rollingHigh）。 */
  confirmed: boolean;
  /** 盘中是否出现 high > rollingHigh 但尚未收盘（INTRABAR）。 */
  intradayAttempt: boolean;
  /** 突破后已收盘的 4H K 线根数。 */
  barsSinceBreakout: number | null;
  /** 突破后经过的小时数（按已收盘 K 线估算）。 */
  hoursSinceBreakout: number | null;
  /**
   * Episode 归属（V2 整改 §5：实时/历史/回测同一 Builder）。
   * 最近一个 trigger 属于旧 episode 还是新 episode start。
   * 可选字段：老消费者不受影响；无突破时为 null。
   */
  episodeId?: string | null;
  /** 该 trigger 在其 episode 中的序号（1 = episode start）。 */
  triggerIndexInEpisode?: number | null;
  /** 所属 episode 当前共吸收的 trigger 数。 */
  triggersInEpisode?: number | null;
  /** 是否为 episode start（新一轮独立突破）。 */
  isEpisodeStart?: boolean | null;
}

/* ------------------------------------------------------------------ */
/* 环境状态                                                             */
/* ------------------------------------------------------------------ */

export interface EnvironmentState {
  gate: EnvironmentGate;
  btcTrend: 'up' | 'down' | 'range' | 'unknown';
  btcReturn7dPct: number | null;
  btcCloseAboveEma100: boolean | null;
  btc24hMaxDrawdownPct: number | null;
  btcHardBreakdown: boolean;
  /** 板块广度：兄弟币种相对 BTC 的强度（%，ratio-based）。 */
  memeBreadthPct: number | null;
  reasons: string[];
}

/* ------------------------------------------------------------------ */
/* 关键价位                                                             */
/* ------------------------------------------------------------------ */

export interface KeyLevels {
  /** 当前下一压力（此前 N 根最高价，rolling）。 */
  resistance: number | null;
  /** 最近一次已确认突破的突破位（未突破时为 null）。 */
  breakoutLevel: number | null;
  /** 硬失效价。 */
  invalidation: number | null;
  /** EMA20。 */
  ema20: number | null;
}

/* ------------------------------------------------------------------ */
/* 条件项                                                               */
/* ------------------------------------------------------------------ */

export interface ConditionItem {
  key: string;
  label: string;
  met: boolean;
  /** true 表示因数据缺失不可判定（不能当通过，也不能当不通过）。 */
  unknown: boolean;
  detail: string;
  weight?: number;
}

/* ------------------------------------------------------------------ */
/* 特征向量（point-in-time）                                            */
/* ------------------------------------------------------------------ */

export interface FeatureVectorV2 {
  /* ---- Setup（只允许突破前数据） ---- */
  compressionRatio: number | null;
  atrPercentile60d: number | null;
  volumeContractionRatio: number | null;
  volumePercentile60d: number | null;
  distanceToResistancePct: number | null;
  baseDurationCandles: number | null;
  higherLow: boolean | null;
  relativeStrengthPct: number | null;
  relativeStrengthPercentile: number | null;
  relativeStrengthSlope: number | null;
  aboveEma20: boolean | null;
  emaBullishStack: boolean | null;
  preReturn7dPct: number | null;
  /* ---- Trigger（突破发生后才计算） ---- */
  breakoutVolRatio: number | null;
  breakoutBodyStrength: number | null;
  breakoutCloseLocation: number | null;
  breakoutRelBtcPct: number | null;
  /* ---- Follow-through（只允许 breakoutTs 之后数据） ---- */
  followThrough24hVolRatio: number | null;
  followThrough48hVolRatio: number | null;
  heldAboveBreakoutLevel: boolean | null;
  retestedBreakoutLevel: boolean | null;
  /* ---- Risk ---- */
  fundingAvgPct: number | null;
  fundingMaxPct: number | null;
  emaDistancePct: number | null;
  atrExpansionRatio: number | null;
}

/* ------------------------------------------------------------------ */
/* 最终信号                                                             */
/* ------------------------------------------------------------------ */

export interface AssetSignal {
  asset: AssetId;
  state: StateCode;
  stateLabel: string;

  environment: EnvironmentState;

  setup: LayeredScore;
  setupConditions: ConditionItem[];

  trigger: LayeredScore;
  triggerConditions: ConditionItem[];

  followThrough: LayeredScore;
  followThroughConditions: ConditionItem[];

  risk: LayeredScore;
  riskFactors: ConditionItem[];

  hardVeto: { kind: HardVetoKind; reason: string | null };

  breakout: BreakoutInfo;
  keyLevels: KeyLevels;
  features: FeatureVectorV2;

  dataQuality: {
    missingFields: string[];
    staleFields: string[];
    degraded: boolean;
    summary: string;
  };
}
