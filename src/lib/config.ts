/**
 * V2 阈值与权重集中配置。
 *
 * 重要声明：以下阈值与权重均为「候选规则」。PEPE / DOGE 的绝对阈值天然可能有偏，
 * 因此优先使用分位（percentile）口径，绝对阈值仅作兜底。最终取舍以 walk-forward
 * 回测结果为准，而非拍脑袋。
 * 所有阈值、权重、窗口都集中于此，不散落在组件或评分逻辑中。
 */
import type { StateCode } from './types';

export interface V2Thresholds {
  /** rolling 突破回看根数（7 天 × 6 根 4H）。 */
  breakoutLookbackCandles: number;
  /** 突破量比：强确认（绝对，兜底）。 */
  breakoutVolRatioStrong: number;
  /** 突破量比：弱确认（绝对，兜底）。 */
  breakoutVolRatioWeak: number;
  /** 成交量分位：当前量能处于过去 N 根的百分位 ≥ 该值视为放量（percentile 优先）。 */
  volumePercentileStrong: number;
  /** Setup 蓄势窗口（近 N 日）。 */
  recentDays: number;
  /** Setup 蓄势窗口（前 N 日）。 */
  priorDays: number;
  /** ATR 收缩比阈值（近/前，越小越收缩）。 */
  atrCompression: number;
  /** ATR 分位：当前 ATR 处于过去 60D 的分位 ≤ 该值视为收缩。 */
  atrPercentileLow: number;
  /** 距阻力 8% 以内视为临界。 */
  nearResistancePct: number;
  /** Base Duration 最短根数（蓄势时长）。 */
  baseDurationMinCandles: number;
  /** 相对强度观察窗口（根数，4H）。 */
  relativeStrengthWindow: number;
  /** 相对强度分位窗口（根数）。 */
  relativeStrengthPercentileWindow: number;
  /** Follow-through 24h/48h 量能持续阈值（相对基线中位数）。 */
  followThroughVolRatio: number;
  /** 追涨距离：价格距离 EMA20 超过该百分比视为追涨过远（风险）。 */
  chaseDistancePct: number;
  /** 资金费率过热（绝对值 %）：超过视为拥挤。 */
  fundingOverheatPct: number;
  /** BTC 24H 最大回撤（负值）：超过（更负）视为结构风险 / 硬破位。 */
  btcMaxDrawdownPct: number;
  /** ATR 极端扩张：近/前 ATR 比超过该值视为风险。 */
  atrExpansionRisk: number;
  /** 回踩观察带宽（突破位上下 %）。 */
  retestBandPct: number;
}

export const DEFAULT_V2_THRESHOLDS: V2Thresholds = {
  breakoutLookbackCandles: 42,
  breakoutVolRatioStrong: 2.0,
  breakoutVolRatioWeak: 1.2,
  volumePercentileStrong: 90,
  recentDays: 3,
  priorDays: 7,
  atrCompression: 0.9,
  atrPercentileLow: 20,
  nearResistancePct: 8,
  baseDurationMinCandles: 12,
  relativeStrengthWindow: 12,
  relativeStrengthPercentileWindow: 60,
  followThroughVolRatio: 1.0,
  chaseDistancePct: 25,
  fundingOverheatPct: 0.03,
  btcMaxDrawdownPct: -10,
  atrExpansionRisk: 1.5,
  retestBandPct: 2,
};

/** 各层评分权重（合计 100）。 */
export interface V2Weights {
  setup: {
    atrCompression: number;
    volumeContraction: number;
    distanceToResistance: number;
    baseDuration: number;
    higherLow: number;
    relativeStrength: number;
    emaBullishStack: number;
  };
  trigger: {
    closeBreakout: number;
    volumeRatio: number;
    bodyStrength: number;
    closeLocation: number;
    relBtc: number;
    noFakeBreakout: number;
  };
  followThrough: {
    heldAbove: number;
    vol24h: number;
    vol48h: number;
    healthyRetest: number;
    relStrength: number;
  };
}

export const DEFAULT_V2_WEIGHTS: V2Weights = {
  setup: {
    atrCompression: 20,
    volumeContraction: 15,
    distanceToResistance: 20,
    baseDuration: 10,
    higherLow: 10,
    relativeStrength: 15,
    emaBullishStack: 10,
  },
  trigger: {
    closeBreakout: 25,
    volumeRatio: 20,
    bodyStrength: 15,
    closeLocation: 15,
    relBtc: 15,
    noFakeBreakout: 10,
  },
  followThrough: {
    heldAbove: 25,
    vol24h: 20,
    vol48h: 15,
    healthyRetest: 20,
    relStrength: 20,
  },
};

export interface AppConfig {
  thresholds: V2Thresholds;
  weights: V2Weights;
}

export const DEFAULT_CONFIG: AppConfig = {
  thresholds: DEFAULT_V2_THRESHOLDS,
  weights: DEFAULT_V2_WEIGHTS,
};

/** 十个状态的中文标签与语义（纯展示映射，判定逻辑在 state-machine）。 */
export const STATE_META: Record<StateCode, { label: string; short: string; description: string }> = {
  MARKET_BLOCKED: { label: '市场禁止', short: '禁止', description: 'BTC 硬破位 / 数据异常，环境不允许关注山寨币突破' },
  NO_SETUP: { label: '无蓄势', short: '无蓄势', description: '尚无突破前蓄势结构' },
  BUILDING_SETUP: { label: '蓄势形成中', short: '蓄势', description: '缩量缩波初现，蓄势尚未充分' },
  NEAR_BREAKOUT: { label: '临界突破', short: '临界', description: '接近阻力，蓄势就绪，等待 4H 收盘确认' },
  BREAKOUT_CONFIRMED: { label: '突破确认', short: '确认', description: '4H 收盘突破本轮突破位' },
  FOLLOW_THROUGH_PENDING: { label: '等待跟随', short: '跟随待定', description: '突破刚成立，突破后数据尚未攒够' },
  HEALTHY_BREAKOUT: { label: '健康突破', short: '健康', description: '突破后站稳，量能与相对强度延续' },
  RETESTING: { label: '回踩确认', short: '回踩', description: '价格回踩突破位，观察是否守住' },
  FAILED_BREAKOUT: { label: '突破失败', short: '失败', description: '突破后快速跌回突破位下方' },
  INVALIDATED: { label: '结构失效', short: '失效', description: '跌破关键结构，信号失效' },
};

/** 资产元数据（全仓唯一标的注册表：现货/永续 symbol、交易所、乘数口径、排序、开关、数据源统一走这里，勿散落字面量）。 */
export interface AssetMeta {
  id: string;
  /** OKX 永续合约 instId（实时 K 线 / 现价 / OKX 资金费率兜底统一用它）。 */
  instId: string;
  /** OKX 现货 instId（描述口径；实时链路当前只走永续，禁拿现货冒充永续）。 */
  spotInstId: string;
  name: string;
  symbol: string;
  /** Binance 永续资金费率 symbol（PEPE 为 1000PEPEUSDT 合约乘数口径，价格换算仍以交易所原始值为准，不做自乘）。 */
  fundingBinanceSymbol: string;
  /** 实时行情主交易所。 */
  exchange: 'okx';
  /** 资金费率数据源优先级（Binance 优先，失败切 OKX，同为实时公开数据）。 */
  fundingProviders: readonly ['binance', 'okx'];
  /** 展示/探测排序（数字越小越前；PEPE → DOGE → ETHFI → BTC）。 */
  sortOrder: number;
  /** 标的开关（false 则全链路不拉取不展示；三币同路径，禁单标特判）。 */
  enabled: boolean;
  /** 是否有历史研究基线（ETHFI 暂无：21 事件无 ETHFI 样本，相关回测/相似度一律缺省，禁编造）。 */
  hasHistoryBaseline: boolean;
  themecolor: string;
}

export const ASSETS: Record<string, AssetMeta> = {
  PEPE: {
    id: 'PEPE',
    instId: 'PEPE-USDT-SWAP',
    spotInstId: 'PEPE-USDT',
    name: 'PEPE',
    symbol: 'PEPE',
    fundingBinanceSymbol: '1000PEPEUSDT',
    exchange: 'okx',
    fundingProviders: ['binance', 'okx'],
    sortOrder: 10,
    enabled: true,
    hasHistoryBaseline: true,
    themecolor: '#37E6A6',
  },
  DOGE: {
    id: 'DOGE',
    instId: 'DOGE-USDT-SWAP',
    spotInstId: 'DOGE-USDT',
    name: 'DOGE',
    symbol: 'DOGE',
    fundingBinanceSymbol: 'DOGEUSDT',
    exchange: 'okx',
    fundingProviders: ['binance', 'okx'],
    sortOrder: 20,
    enabled: true,
    hasHistoryBaseline: true,
    themecolor: '#F5B544',
  },
  /** ETHFI：与 PEPE/DOGE 同框架（Rolling42/十态/六层评分阈值权重零改动），精度由 formatPrice 自适应。 */
  ETHFI: {
    id: 'ETHFI',
    instId: 'ETHFI-USDT-SWAP',
    spotInstId: 'ETHFI-USDT',
    name: 'ETHFI',
    symbol: 'ETHFI',
    fundingBinanceSymbol: 'ETHFIUSDT',
    exchange: 'okx',
    fundingProviders: ['binance', 'okx'],
    sortOrder: 30,
    enabled: true,
    hasHistoryBaseline: false,
    themecolor: '#C084FC',
  },
  BTC: {
    id: 'BTC',
    instId: 'BTC-USDT-SWAP',
    spotInstId: 'BTC-USDT',
    name: 'BTC',
    symbol: 'BTC',
    fundingBinanceSymbol: '',
    exchange: 'okx',
    fundingProviders: ['binance', 'okx'],
    sortOrder: 40,
    enabled: true,
    hasHistoryBaseline: false,
    themecolor: '#8AB4F8',
  },
} as const;

/** 可交易标的（展示/拉取/探测顺序 = ASSETS.sortOrder，PEPE → DOGE → ETHFI）。 */
export const TRADE_COINS = ['PEPE', 'DOGE', 'ETHFI'] as const;
export type TradeCoin = (typeof TRADE_COINS)[number];

/** K 线/现价全量口径（含 BTC 环境参照）。 */
export const MARKET_COINS = ['BTC', 'PEPE', 'DOGE', 'ETHFI'] as const;
export type MarketCoin = (typeof MARKET_COINS)[number];

/** 有历史研究基线的标的（由 ASSETS.hasHistoryBaseline 派生；ETHFI 暂无基线，不在此列）。 */
export const BASELINE_COINS: readonly string[] = TRADE_COINS.filter((c) => ASSETS[c].hasHistoryBaseline);

/** 标的开关默认（alert 订阅/展示共用唯一来源，禁各处手写 true/false）。 */
export const DEFAULT_COIN_SWITCHES: Record<TradeCoin, boolean> = {
  PEPE: ASSETS.PEPE.enabled,
  DOGE: ASSETS.DOGE.enabled,
  ETHFI: ASSETS.ETHFI.enabled,
};

/** 历史快照文件键（data/ 下研究快照唯一映射；null = 无基线快照，调用方按缺数据处理，禁编造）。 */
export const SNAPSHOT_KEYS: Record<string, { candles: string | null; funding: string | null }> = {
  PEPE: { candles: 'pepe-usdt-swap', funding: '1000pepeusdt' },
  DOGE: { candles: 'doge-usdt-swap', funding: 'dogeusdt' },
  BTC: { candles: 'btc-usdt-swap', funding: null },
  ETHFI: { candles: null, funding: null },
};

/** OKX 永续 instId 展示行（来源行文案唯一来源，禁各处手写拼接）。 */
export const OKX_PERP_LINE: string = (() => {
  const ids = [...TRADE_COINS, 'BTC' as const].map((c) => ASSETS[c].instId as string);
  const suffix = '-USDT-SWAP';
  if (ids.every((s) => s.endsWith(suffix))) {
    return `${ids.map((s) => s.slice(0, -suffix.length)).join('/')}${suffix}`;
  }
  return ids.join(' / ');
})();
