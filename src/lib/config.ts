/**
 * 权重与候选阈值集中配置。
 *
 * 重要声明：以下阈值与权重均为「候选规则」，来自 21 个已挑选的成功上涨样本，
 * 尚未经过失败样本 / 样本外检验，因此**不能作为已验证策略或胜率依据**。
 * 所有权重、阈值、窗口都集中于此，不散落在组件或评分逻辑中。
 */

export interface ThresholdConfig {
  /** 启动前 ATR 收缩：最近 3 日 ATR / 前 7 日 ATR ≤ 该值视为强候选 */
  atrCompression: number;
  /** 突破 K 线量比强确认 */
  breakoutVolRatioStrong: number;
  /** 突破 K 线量比弱确认 */
  breakoutVolRatioWeak: number;
  /** 启动后持续量能（24~48h 均量 / 前 7 日中位量）≥ 该值视为持续 */
  persistentVolumeRatio: number;
  /** 追涨距离：价格距离 EMA20 超过该百分比视为追涨过远（风险） */
  chaseDistancePct: number;
  /** 资金费率过热（绝对值 %）：超过视为拥挤 */
  fundingOverheatPct: number;
  /** BTC 24H 最大回撤（负值）：超过（更负）视为结构风险 */
  btcMaxDrawdownPct: number;
  /** 相对强度斜率观察窗口（根数） */
  relativeStrengthWindow: number;
  /** 结构阻力回看窗口（日） */
  structureLookbackDays: number;
  /** 蓄势窗口：近 3 日 */
  recentDays: number;
  /** 蓄势窗口：前 7 日 */
  priorDays: number;
}

export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  atrCompression: 0.9,
  breakoutVolRatioStrong: 2.0,
  breakoutVolRatioWeak: 1.2,
  persistentVolumeRatio: 1.0,
  chaseDistancePct: 25,
  fundingOverheatPct: 0.03,
  btcMaxDrawdownPct: -10,
  relativeStrengthWindow: 12,
  structureLookbackDays: 7,
  recentDays: 3,
  priorDays: 7,
};

/**
 * 机会准备度（opportunityScore）权重。四层合计 100 分。
 * 各层、各指标的分布与研究报告第六节一致。
 */
export interface OpportunityWeights {
  environment: {
    btcRisk: number;
    btcTrend: number;
    memeRelBtc: number;
    breadth: number;
    resonance: number;
  };
  preparation: {
    atrCompression: number;
    volumeContraction: number;
    structureBase: number;
    resistanceCompression: number;
    relStrength: number;
  };
  breakout: {
    closeBreakout: number;
    volumeRatio: number;
    persistentVolume: number;
    relOutperform: number;
    pullback: number;
  };
  risk: {
    notCrowded: number;
    btcNoHardExit: number;
    coinNoInvalidation: number;
    chaseDistance: number;
    riskReward: number;
  };
}

export const DEFAULT_OPPORTUNITY_WEIGHTS: OpportunityWeights = {
  environment: {
    btcRisk: 8,
    btcTrend: 5,
    memeRelBtc: 5,
    breadth: 4,
    resonance: 3,
  },
  preparation: {
    atrCompression: 6,
    volumeContraction: 5,
    structureBase: 5,
    resistanceCompression: 5,
    relStrength: 4,
  },
  breakout: {
    closeBreakout: 10,
    volumeRatio: 7,
    persistentVolume: 5,
    relOutperform: 4,
    pullback: 4,
  },
  risk: {
    notCrowded: 5,
    btcNoHardExit: 5,
    coinNoInvalidation: 5,
    chaseDistance: 3,
    riskReward: 2,
  },
};

export interface AppConfig {
  thresholds: ThresholdConfig;
  opportunityWeights: OpportunityWeights;
}

export const DEFAULT_CONFIG: AppConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  opportunityWeights: DEFAULT_OPPORTUNITY_WEIGHTS,
};

/** 六个状态的中文标签与语义（纯展示映射，判定逻辑在 state-machine）。 */
export const STATE_META = {
  forbidden: { label: '禁止关注', short: '禁止', description: 'BTC 急跌或币种结构继续创新低' },
  accumulating: { label: '蓄势观察', short: '蓄势', description: '缩量缩波出现，但突破尚未确认' },
  near_breakout: { label: '临界突破', short: '临界', description: '接近阻力，量能或相对强度开始恢复' },
  breakout_confirmed: { label: '突破确认', short: '确认', description: '4H 收盘突破，量能与相对强弱确认' },
  awaiting_pullback: { label: '等待回踩', short: '回踩', description: '突破成立但价格已明显远离观察区' },
  invalidated: { label: '信号失效', short: '失效', description: '跌回结构、BTC 破位或量价明显恶化' },
} as const;

/** 资产元数据。资金费率 Binance 符号为跨交易所参考。 */
export const ASSETS = {
  PEPE: {
    id: 'PEPE',
    instId: 'PEPE-USDT-SWAP',
    name: 'PEPE',
    symbol: 'PEPE',
    fundingBinanceSymbol: '1000PEPEUSDT',
    themecolor: '#37E6A6',
  },
  DOGE: {
    id: 'DOGE',
    instId: 'DOGE-USDT-SWAP',
    name: 'DOGE',
    symbol: 'DOGE',
    fundingBinanceSymbol: 'DOGEUSDT',
    themecolor: '#F5B544',
  },
  BTC: {
    id: 'BTC',
    instId: 'BTC-USDT-SWAP',
    name: 'BTC',
    symbol: 'BTC',
    fundingBinanceSymbol: '',
    themecolor: '#8AB4F8',
  },
} as const;