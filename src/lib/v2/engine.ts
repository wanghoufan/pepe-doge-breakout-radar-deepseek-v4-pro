/**
 * V2 实时引擎（point-in-time）。
 *
 * 把实时/历史共用的纯函数组合成最终「分层信号」：
 *   Environment Gate → Setup → Trigger → Follow-through → Risk → Hard Veto → 状态机。
 *
 * 关键约束（本轮最高原则）：
 * - 所有特征只使用「该时点已经收盘」的数据；未收盘 K 线不参与任何判定。
 * - Setup 只用突破前数据；Trigger 只在突破后计算；Follow-through 只用 breakoutTs 之后数据。
 * - 数据缺失显式表示为 WAITING / PENDING / NOT_STARTED / DATA_UNAVAILABLE，绝不等于 0 分。
 */
import { avg, emaSeries, meanTrueRangePct, median, pct } from '../indicators';
import { percentileRank } from '../statistics';
import { detectBreakout, getRollingHigh, DEFAULT_BREAKOUT_CONFIG, type BreakoutSignal } from '../breakout';
import { relativeReturn, relativeStrengthPercentile, relativeStrengthSlope } from '../relative-strength';
import { determineStateV2 } from '../state-machine';
import {
  DEFAULT_CONFIG,
  STATE_META,
  type AppConfig,
  type V2Thresholds,
  type V2Weights,
} from '../config';
import type {
  AssetId,
  AssetSignal,
  Candle,
  ConditionItem,
  EnvironmentGate,
  EnvironmentState,
  FeatureVectorV2,
  HardVetoKind,
  KeyLevels,
  LayeredScore,
  ScoreStatus,
} from '../types';

const CANDLES_PER_DAY = 6; // 4H

export interface AnalyzeContextV2 {
  /** 兄弟币种（PEPE↔DOGE）相对 BTC 的强度 %（ratio-based），用于板块广度。 */
  peerRelativeStrengthPct: number | null;
}

/* ------------------------------------------------------------------ */
/* 条件打分工具                                                         */
/* ------------------------------------------------------------------ */

interface Cond {
  key: string;
  label: string;
  met: boolean;
  unknown: boolean;
  detail: string;
  weight: number;
}

function scoreConds(rows: Cond[]): { items: ConditionItem[]; score: number; available: number } {
  let score = 0;
  let available = 0;
  const items = rows.map((r) => {
    if (!r.unknown) available += r.weight;
    if (r.met) score += r.weight;
    return {
      key: r.key,
      label: r.label,
      met: r.met,
      unknown: r.unknown,
      detail: r.detail,
      weight: r.weight,
    };
  });
  return { items, score, available };
}

function norm100(score: number, available: number): number | null {
  if (available <= 0) return null;
  return Math.round(Math.max(0, Math.min(100, (score / available) * 100)));
}

function fmtPct(v: number | null, digits = 2): string {
  return v == null ? '数据缺失' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

/* ------------------------------------------------------------------ */
/* BTC 环境（供 overview 与 Environment Gate 共用）                    */
/* ------------------------------------------------------------------ */

export interface BtcEnvFields {
  return7dPct: number | null;
  maxDrawdown24hPct: number | null;
  closeAboveEma100: boolean | null;
  hardBreakdown: boolean;
  trend: 'up' | 'down' | 'range' | 'unknown';
}

export function computeBtcEnvironment(btc: Candle[], t: V2Thresholds): BtcEnvFields {
  const bars = btc.slice().sort((a, b) => a.ts - b.ts);
  const last = bars.at(-1);
  if (!last) {
    return {
      return7dPct: null,
      maxDrawdown24hPct: null,
      closeAboveEma100: null,
      hardBreakdown: false,
      trend: 'unknown',
    };
  }
  const nowTs = last.ts;
  const weekAgo = bars.filter((b) => b.ts >= nowTs - 7 * 86_400_000);
  const return7dPct = weekAgo.length >= 2 ? pct(last.c, weekAgo[0].o) : null;

  const btc1d = bars.filter((b) => b.ts >= nowTs - 86_400_000 && b.ts <= nowTs);
  let maxDrawdown24hPct: number | null = null;
  if (btc1d.length >= 2) {
    let peak = -Infinity;
    let dd = 0;
    for (const b of btc1d) {
      peak = Math.max(peak, b.h);
      dd = Math.min(dd, pct(b.l, peak));
    }
    maxDrawdown24hPct = dd;
  }

  const ema100 = emaSeries(bars.map((b) => b.c), 100).at(-1) ?? null;
  const closeAboveEma100 = ema100 != null ? last.c >= ema100 : null;

  const hardBreakdown = maxDrawdown24hPct != null && maxDrawdown24hPct <= t.btcMaxDrawdownPct;
  let trend: BtcEnvFields['trend'] = 'unknown';
  if (closeAboveEma100 != null && return7dPct != null) {
    trend = closeAboveEma100 && return7dPct > 0 ? 'up' : !closeAboveEma100 && return7dPct < 0 ? 'down' : 'range';
  }

  return { return7dPct, maxDrawdown24hPct, closeAboveEma100, hardBreakdown, trend };
}

/* ------------------------------------------------------------------ */
/* Setup 特征（只允许突破前数据）                                       */
/* ------------------------------------------------------------------ */

interface SetupFeatures {
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
}

export function computeSetupFeatures(
  bars: Candle[],
  btc: Candle[],
  t: V2Thresholds,
): SetupFeatures {
  const n = bars.length;
  const last = bars.at(-1)!;
  const recentN = t.recentDays * CANDLES_PER_DAY;
  const priorN = t.priorDays * CANDLES_PER_DAY;

  const recent = bars.slice(-recentN);
  const prior = bars.slice(-(recentN + priorN), -recentN);

  const rollingHigh = getRollingHigh(bars, n - 1, t.breakoutLookbackCandles);

  const atrRecent = meanTrueRangePct(recent);
  const atrPrior = meanTrueRangePct(prior);
  const compressionRatio = atrRecent != null && atrPrior != null && atrPrior > 0 ? atrRecent / atrPrior : null;

  // ATR 分位：当前 18 根 ATR% 在最近 60 日滚动窗口中的分位
  let atrPercentile60d: number | null = null;
  {
    const window = 60 * CANDLES_PER_DAY;
    const rolling: number[] = [];
    for (let i = n - window; i <= n - recentN; i++) {
      if (i < 0) continue;
      const slice = bars.slice(i, i + recentN);
      const v = meanTrueRangePct(slice);
      if (v != null) rolling.push(v);
    }
    if (atrRecent != null && rolling.length) atrPercentile60d = percentileRank(rolling, atrRecent);
  }

  const volRecent = avg(recent.map((b) => b.quoteVol));
  const volPrior = avg(prior.map((b) => b.quoteVol));
  const volumeContractionRatio = volRecent != null && volPrior != null && volPrior > 0 ? volRecent / volPrior : null;

  let volumePercentile60d: number | null = null;
  {
    const window = 60 * CANDLES_PER_DAY;
    const hist = bars.slice(Math.max(0, n - 1 - window), n - 1).map((b) => b.quoteVol);
    if (hist.length && last.quoteVol > 0) volumePercentile60d = percentileRank(hist, last.quoteVol);
  }

  const distanceToResistancePct = rollingHigh != null ? pct(last.c, rollingHigh) : null;

  // Base Duration：rollingHigh 来源 K 线距今的根数
  let baseDurationCandles: number | null = null;
  if (n > 0) {
    const from = Math.max(0, n - t.breakoutLookbackCandles);
    let maxHi = -Infinity;
    let maxIdx = from;
    for (let i = from; i < n - 1; i++) {
      if (bars[i].h > maxHi) {
        maxHi = bars[i].h;
        maxIdx = i;
      }
    }
    baseDurationCandles = n - 1 - maxIdx;
  }

  const higherLow = recent.length && prior.length ? Math.min(...recent.map((b) => b.l)) > Math.min(...prior.map((b) => b.l)) : null;

  const relativeStrengthPct = relativeReturn(bars, btc, t.relativeStrengthWindow);
  const relativeStrengthPercentileV = relativeStrengthPercentile(bars, btc, t.relativeStrengthPercentileWindow);
  const relativeStrengthSlopeV = relativeStrengthSlope(bars, btc, t.relativeStrengthWindow);

  const ema20 = emaSeries(bars.map((b) => b.c), 20).at(-1) ?? null;
  const ema50 = emaSeries(bars.map((b) => b.c), 50).at(-1) ?? null;
  const ema100 = emaSeries(bars.map((b) => b.c), 100).at(-1) ?? null;

  const pre7 = bars.filter((b) => b.ts >= last.ts - 7 * 86_400_000);
  const preReturn7dPct = pre7.length >= 2 ? pct(pre7.at(-1)!.c, pre7[0].o) : null;

  return {
    compressionRatio,
    atrPercentile60d,
    volumeContractionRatio,
    volumePercentile60d,
    distanceToResistancePct,
    baseDurationCandles,
    higherLow,
    relativeStrengthPct,
    relativeStrengthPercentile: relativeStrengthPercentileV,
    relativeStrengthSlope: relativeStrengthSlopeV,
    aboveEma20: ema20 != null ? last.c >= ema20 : null,
    emaBullishStack: ema20 != null && ema50 != null && ema100 != null ? ema20 > ema50 && ema50 > ema100 : null,
    preReturn7dPct,
  };
}

/* ------------------------------------------------------------------ */
/* 相对收益（在指定终点下标处，point-in-time）                         */
/* ------------------------------------------------------------------ */

function relativeReturnAt(
  bars: Candle[],
  btc: Candle[],
  endIdx: number,
  horizonCandles: number,
): number | null {
  const coin = bars.slice(0, endIdx + 1);
  const endTs = bars[endIdx].ts;
  const btcSlice = btc.filter((b) => b.ts <= endTs);
  return relativeReturn(coin, btcSlice, horizonCandles);
}

/* ------------------------------------------------------------------ */
/* Trigger / Follow-through 特征（只在突破后）                         */
/* ------------------------------------------------------------------ */

interface PostBreakoutFeatures {
  breakout: BreakoutSignal | null;
  barsSinceBreakout: number | null;
  hoursSinceBreakout: number | null;
  breakoutVolRatio: number | null;
  breakoutBodyStrength: number | null;
  breakoutCloseLocation: number | null;
  breakoutRelBtcPct: number | null;
  followThrough24hVolRatio: number | null;
  followThrough48hVolRatio: number | null;
  heldAboveBreakoutLevel: boolean | null;
  retestedBreakoutLevel: boolean | null;
  fakeBreakoutWick: boolean | null;
}

export function computePostBreakoutFeatures(
  bars: Candle[],
  btc: Candle[],
  t: V2Thresholds,
): PostBreakoutFeatures {
  const sig = detectBreakout(bars, {
    ...DEFAULT_BREAKOUT_CONFIG,
    lookbackCandles: t.breakoutLookbackCandles,
  });

  if (!sig) {
    return {
      breakout: null,
      barsSinceBreakout: null,
      hoursSinceBreakout: null,
      breakoutVolRatio: null,
      breakoutBodyStrength: null,
      breakoutCloseLocation: null,
      breakoutRelBtcPct: null,
      followThrough24hVolRatio: null,
      followThrough48hVolRatio: null,
      heldAboveBreakoutLevel: null,
      retestedBreakoutLevel: null,
      fakeBreakoutWick: null,
    };
  }

  const n = bars.length;
  const last = bars.at(-1)!;
  const brk = bars[sig.index];
  const range = brk.h - brk.l;
  const breakoutBodyStrength = range > 0 ? Math.abs(brk.c - brk.o) / range : null;
  const breakoutCloseLocation = range > 0 ? (brk.c - brk.l) / range : null;
  const breakoutRelBtcPct = relativeReturnAt(bars, btc, sig.index, t.relativeStrengthWindow);
  // 长上影 = 假突破结构风险
  const fakeBreakoutWick = range > 0 ? (brk.h - brk.c) / range > 0.5 : null;

  const barsSinceBreakout = n - 1 - sig.index;
  const hoursSinceBreakout = barsSinceBreakout * 4;

  // Follow-through 量能：从 breakoutTs 之后算（不含突破 K 线本身）
  const baseline = bars.slice(Math.max(0, sig.index - t.breakoutLookbackCandles), sig.index).map((b) => b.quoteVol);
  const baselineMed = median(baseline);

  const post = bars.filter((b) => b.ts > sig.ts);
  const in24 = post.filter((b) => b.ts <= sig.ts + 24 * 3_600_000);
  const in48 = post.filter((b) => b.ts <= sig.ts + 48 * 3_600_000);
  const followThrough24hVolRatio =
    baselineMed != null && baselineMed > 0 && in24.length >= CANDLES_PER_DAY
      ? avg(in24.map((b) => b.quoteVol))! / baselineMed
      : null;
  const followThrough48hVolRatio =
    baselineMed != null && baselineMed > 0 && in48.length >= 2 * CANDLES_PER_DAY
      ? avg(in48.map((b) => b.quoteVol))! / baselineMed
      : null;

  const heldAboveBreakoutLevel = last.c > sig.level;
  const minPostLow = post.length ? Math.min(...post.map((b) => b.l)) : null;
  const retestedBreakoutLevel =
    minPostLow != null ? minPostLow <= sig.level * (1 + t.retestBandPct / 100) && heldAboveBreakoutLevel : null;

  return {
    breakout: sig,
    barsSinceBreakout,
    hoursSinceBreakout,
    breakoutVolRatio: sig.volumeRatio,
    breakoutBodyStrength,
    breakoutCloseLocation,
    breakoutRelBtcPct,
    followThrough24hVolRatio,
    followThrough48hVolRatio,
    heldAboveBreakoutLevel,
    retestedBreakoutLevel,
    fakeBreakoutWick,
  };
}

/* ------------------------------------------------------------------ */
/* 环境闸门                                                             */
/* ------------------------------------------------------------------ */

export function evaluateEnvironment(
  btcEnv: BtcEnvFields,
  peerRelativeStrengthPct: number | null,
): EnvironmentState {
  const reasons: string[] = [];
  let gate: EnvironmentGate = 'ALLOW';

  if (btcEnv.hardBreakdown) {
    gate = 'BLOCK';
    reasons.push('BTC 24h 硬破位，禁止关注山寨币突破');
  } else if (btcEnv.closeAboveEma100 === false || btcEnv.trend === 'down') {
    gate = 'CAUTION';
    reasons.push('BTC 处于 EMA100 下方 / 下行结构');
  } else if (btcEnv.trend === 'up') {
    reasons.push('BTC 处于上行结构');
  }

  if (peerRelativeStrengthPct != null && peerRelativeStrengthPct < -3 && gate === 'ALLOW') {
    gate = 'CAUTION';
    reasons.push('山寨板块广度偏弱');
  }

  if (gate === 'ALLOW' && reasons.length === 0) reasons.push('市场环境中性偏暖');

  return {
    gate,
    btcTrend: btcEnv.trend,
    btcReturn7dPct: btcEnv.return7dPct,
    btcCloseAboveEma100: btcEnv.closeAboveEma100,
    btc24hMaxDrawdownPct: btcEnv.maxDrawdown24hPct,
    btcHardBreakdown: btcEnv.hardBreakdown,
    memeBreadthPct: peerRelativeStrengthPct,
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* 硬否决                                                               */
/* ------------------------------------------------------------------ */

export function evaluateHardVeto(
  bars: Candle[],
  btcEnv: BtcEnvFields,
  invalidated: boolean,
  t: V2Thresholds,
): { kind: HardVetoKind; reason: string | null } {
  if (bars.length < t.breakoutLookbackCandles + 1) {
    return { kind: 'DATA_VETO', reason: `已收盘 K 线不足（${bars.length} 根，需 ≥ ${t.breakoutLookbackCandles + 1}）` };
  }
  if (btcEnv.hardBreakdown) {
    return { kind: 'BTC_VETO', reason: 'BTC 24h 回撤触发硬破位阈值' };
  }
  if (invalidated) {
    return { kind: 'STRUCTURE_VETO', reason: '币种跌破关键结构失效位' };
  }
  const last = bars.at(-1)!;
  if (last.quoteVol <= 0 || !Number.isFinite(last.quoteVol)) {
    return { kind: 'LIQUIDITY_VETO', reason: '成交额异常（为 0 或缺失）' };
  }
  return { kind: 'NONE', reason: null };
}

/* ------------------------------------------------------------------ */
/* 主引擎                                                               */
/* ------------------------------------------------------------------ */

export function analyzeAssetV2(
  asset: AssetId,
  candles: Candle[],
  intraday: Candle | null,
  btcCandles: Candle[],
  funding: { ts: number; rate: number }[],
  ctx: AnalyzeContextV2,
  config: AppConfig = DEFAULT_CONFIG,
): AssetSignal {
  const t = config.thresholds;
  const w = config.weights;

  const bars = candles.slice().sort((a, b) => a.ts - b.ts);
  const btc = btcCandles.slice().sort((a, b) => a.ts - b.ts);
  const last = bars.at(-1)!;

  const btcEnv = computeBtcEnvironment(btc, t);
  const environment = evaluateEnvironment(btcEnv, ctx.peerRelativeStrengthPct);

  const setup = computeSetupFeatures(bars, btc, t);
  const post = computePostBreakoutFeatures(bars, btc, t);

  const rollingHigh = getRollingHigh(bars, bars.length - 1, t.breakoutLookbackCandles);
  const invalidated = rollingHigh != null ? last.c < rollingHigh * 0.94 : false;
  const hardVeto = evaluateHardVeto(bars, btcEnv, invalidated, t);

  // ---------------- Setup 评分（0~100） ----------------
  const setupRows: Cond[] = [
    {
      key: 'atrCompression',
      label: 'ATR 收缩（分位或比值达标）',
      met: (setup.atrPercentile60d != null && setup.atrPercentile60d <= t.atrPercentileLow) ||
        (setup.compressionRatio != null && setup.compressionRatio <= t.atrCompression),
      unknown: setup.atrPercentile60d == null && setup.compressionRatio == null,
      detail: `ATR 分位 ${setup.atrPercentile60d == null ? '—' : setup.atrPercentile60d.toFixed(0)} / 压缩比 ${setup.compressionRatio == null ? '—' : setup.compressionRatio.toFixed(2)}`,
      weight: w.setup.atrCompression,
    },
    {
      key: 'volumeContraction',
      label: '量能收缩（近 3 日 / 前 7 日 < 1）',
      met: setup.volumeContractionRatio != null && setup.volumeContractionRatio < 1,
      unknown: setup.volumeContractionRatio == null,
      detail: `量比 ${setup.volumeContractionRatio == null ? '—' : setup.volumeContractionRatio.toFixed(2)}`,
      weight: w.setup.volumeContraction,
    },
    {
      key: 'distanceToResistance',
      label: `距阻力 < ${t.nearResistancePct}%`,
      met: setup.distanceToResistancePct != null && setup.distanceToResistancePct > -t.nearResistancePct,
      unknown: setup.distanceToResistancePct == null,
      detail: `距阻力 ${fmtPct(setup.distanceToResistancePct)}`,
      weight: w.setup.distanceToResistance,
    },
    {
      key: 'baseDuration',
      label: '蓄势时长足够',
      met: setup.baseDurationCandles != null && setup.baseDurationCandles >= t.baseDurationMinCandles,
      unknown: setup.baseDurationCandles == null,
      detail: `蓄势 ${setup.baseDurationCandles == null ? '—' : setup.baseDurationCandles + ' 根'}`,
      weight: w.setup.baseDuration,
    },
    {
      key: 'higherLow',
      label: 'Higher Low 结构',
      met: setup.higherLow === true,
      unknown: setup.higherLow == null,
      detail: setup.higherLow == null ? '数据缺失' : setup.higherLow ? '近低点上移' : '近低点未上移',
      weight: w.setup.higherLow,
    },
    {
      key: 'relativeStrength',
      label: '相对 BTC 转强',
      met: setup.relativeStrengthPct != null && setup.relativeStrengthPct > 0,
      unknown: setup.relativeStrengthPct == null,
      detail: `相对强度 ${fmtPct(setup.relativeStrengthPct)}`,
      weight: w.setup.relativeStrength,
    },
    {
      key: 'emaBullishStack',
      label: 'EMA 多头排列',
      met: setup.emaBullishStack === true,
      unknown: setup.emaBullishStack == null,
      detail: setup.emaBullishStack == null ? '数据缺失' : setup.emaBullishStack ? 'EMA20>50>100' : 'EMA 未多头排列',
      weight: w.setup.emaBullishStack,
    },
  ];
  const setupScored = scoreConds(setupRows);
  const setupScore = norm100(setupScored.score, setupScored.available);
  const setupLayered: LayeredScore = {
    value: setupScore,
    status: setupScore == null ? 'DATA_UNAVAILABLE' : 'COMPUTED',
  };

  // ---------------- Trigger 评分（0~100，突破后才计算） ----------------
  const breakoutConfirmed = post.breakout != null;
  const intradayAttempt =
    !breakoutConfirmed && intraday != null && rollingHigh != null && intraday.h > rollingHigh;

  let triggerLayered: LayeredScore;
  let triggerConditions: ConditionItem[] = [];
  if (!breakoutConfirmed) {
    triggerLayered = {
      value: null,
      status: intradayAttempt ? 'PENDING' : 'WAITING',
      note: intradayAttempt ? '盘中触及阻力，等待 4H 收盘确认' : '等待突破触发',
    };
  } else {
    const tr: Cond[] = [
      {
        key: 'closeBreakout',
        label: '4H 收盘突破 rolling 阻力',
        met: true,
        unknown: false,
        detail: `收盘 ${post.breakout!.close.toFixed(8)} > 阻力 ${post.breakout!.level.toFixed(8)}`,
        weight: w.trigger.closeBreakout,
      },
      {
        key: 'volumeRatio',
        label: '突破量比达标',
        met: post.breakoutVolRatio != null && (post.breakoutVolRatio >= t.breakoutVolRatioWeak || setup.volumePercentile60d != null && setup.volumePercentile60d >= t.volumePercentileStrong),
        unknown: post.breakoutVolRatio == null && setup.volumePercentile60d == null,
        detail: `量比 ${post.breakoutVolRatio == null ? '—' : post.breakoutVolRatio.toFixed(2)}x / 量分位 ${setup.volumePercentile60d == null ? '—' : setup.volumePercentile60d.toFixed(0)}`,
        weight: w.trigger.volumeRatio,
      },
      {
        key: 'bodyStrength',
        label: '突破 K 线实体强劲',
        met: post.breakoutBodyStrength != null && post.breakoutBodyStrength >= 0.5,
        unknown: post.breakoutBodyStrength == null,
        detail: `实体强度 ${post.breakoutBodyStrength == null ? '—' : post.breakoutBodyStrength.toFixed(2)}`,
        weight: w.trigger.bodyStrength,
      },
      {
        key: 'closeLocation',
        label: '收盘位置靠上',
        met: post.breakoutCloseLocation != null && post.breakoutCloseLocation >= 0.5,
        unknown: post.breakoutCloseLocation == null,
        detail: `收盘位置 ${post.breakoutCloseLocation == null ? '—' : post.breakoutCloseLocation.toFixed(2)}`,
        weight: w.trigger.closeLocation,
      },
      {
        key: 'relBtc',
        label: '相对 BTC 同期走强',
        met: post.breakoutRelBtcPct != null && post.breakoutRelBtcPct > 0,
        unknown: post.breakoutRelBtcPct == null,
        detail: `相对 BTC ${fmtPct(post.breakoutRelBtcPct)}`,
        weight: w.trigger.relBtc,
      },
      {
        key: 'noFakeBreakout',
        label: '无假突破结构（非长上影）',
        met: post.fakeBreakoutWick !== true,
        unknown: post.fakeBreakoutWick == null,
        detail: post.fakeBreakoutWick === true ? '出现长上影，警惕假突破' : 'K 线结构正常',
        weight: w.trigger.noFakeBreakout,
      },
    ];
    const scored = scoreConds(tr);
    triggerConditions = scored.items;
    triggerLayered = { value: norm100(scored.score, scored.available), status: 'COMPUTED' };
  }

  // ---------------- Follow-through 评分（0~100） ----------------
  let followThroughLayered: LayeredScore;
  let followThroughConditions: ConditionItem[] = [];
  if (!breakoutConfirmed) {
    followThroughLayered = { value: null, status: 'NOT_STARTED', note: '突破尚未发生' };
  } else if ((post.hoursSinceBreakout ?? 0) < 24) {
    followThroughLayered = { value: null, status: 'PENDING', note: '突破不足 24h，跟随数据未攒够' };
  } else {
    const ft: Cond[] = [
      {
        key: 'heldAbove',
        label: '站稳突破位上方',
        met: post.heldAboveBreakoutLevel === true,
        unknown: post.heldAboveBreakoutLevel == null,
        detail: post.heldAboveBreakoutLevel == null ? '数据缺失' : post.heldAboveBreakoutLevel ? '现价在突破位上方' : '现价跌回突破位下方',
        weight: w.followThrough.heldAbove,
      },
      {
        key: 'vol24h',
        label: '突破后 24h 量能持续',
        met: post.followThrough24hVolRatio != null && post.followThrough24hVolRatio >= t.followThroughVolRatio,
        unknown: post.followThrough24hVolRatio == null,
        detail: `24h 量比 ${post.followThrough24hVolRatio == null ? '—' : post.followThrough24hVolRatio.toFixed(2)}`,
        weight: w.followThrough.vol24h,
      },
      {
        key: 'vol48h',
        label: '突破后 48h 量能持续',
        met: post.followThrough48hVolRatio != null && post.followThrough48hVolRatio >= t.followThroughVolRatio,
        unknown: post.followThrough48hVolRatio == null,
        detail: `48h 量比 ${post.followThrough48hVolRatio == null ? '—' : post.followThrough48hVolRatio.toFixed(2)}`,
        weight: w.followThrough.vol48h,
      },
      {
        key: 'healthyRetest',
        label: '回踩守住突破位',
        met: post.retestedBreakoutLevel === true,
        unknown: post.retestedBreakoutLevel == null,
        detail: post.retestedBreakoutLevel == null ? '数据缺失' : post.retestedBreakoutLevel ? '回踩守住' : '未出现健康回踩',
        weight: w.followThrough.healthyRetest,
      },
      {
        key: 'relStrength',
        label: '相对 BTC 强势延续',
        met: setup.relativeStrengthPct != null && setup.relativeStrengthPct > 0,
        unknown: setup.relativeStrengthPct == null,
        detail: `相对强度 ${fmtPct(setup.relativeStrengthPct)}`,
        weight: w.followThrough.relStrength,
      },
    ];
    const scored = scoreConds(ft);
    followThroughConditions = scored.items;
    followThroughLayered = { value: norm100(scored.score, scored.available), status: 'COMPUTED' };
  }

  // ---------------- Risk 评分（0~100，越高越危险） ----------------
  const fundingAvgPct = funding.length ? (avg(funding.map((r) => r.rate)) ?? 0) * 100 : null;
  const fundingMaxPct = funding.length ? Math.max(...funding.map((r) => r.rate)) * 100 : null;
  const ema20 = emaSeries(bars.map((b) => b.c), 20).at(-1) ?? null;
  const emaDistancePct = ema20 != null && ema20 > 0 ? pct(last.c, ema20) : null;
  const atrExpansionRatio = setup.compressionRatio != null ? 1 / setup.compressionRatio : null;

  let riskVal = 0;
  const riskFactors: Cond[] = [];
  const pushRisk = (c: Cond, add: number) => {
    riskFactors.push(c);
    if (c.met) riskVal += add;
  };
  pushRisk(
    {
      key: 'chase',
      label: '追涨过远',
      met: emaDistancePct != null && emaDistancePct > t.chaseDistancePct,
      unknown: emaDistancePct == null,
      detail: `距 EMA20 ${fmtPct(emaDistancePct)}`,
      weight: 0,
    },
    40,
  );
  pushRisk(
    {
      key: 'shortGain',
      label: '短期涨幅过大',
      met: setup.preReturn7dPct != null && setup.preReturn7dPct > 40,
      unknown: setup.preReturn7dPct == null,
      detail: `7 日收益 ${fmtPct(setup.preReturn7dPct)}`,
      weight: 0,
    },
    15,
  );
  pushRisk(
    {
      key: 'atrExpansion',
      label: 'ATR 极端扩张',
      met: atrExpansionRatio != null && atrExpansionRatio >= t.atrExpansionRisk,
      unknown: atrExpansionRatio == null,
      detail: `ATR 扩张比 ${atrExpansionRatio == null ? '—' : atrExpansionRatio.toFixed(2)}`,
      weight: 0,
    },
    15,
  );
  pushRisk(
    {
      key: 'crowded',
      label: '资金费率拥挤',
      met: fundingAvgPct != null && fundingAvgPct >= t.fundingOverheatPct,
      unknown: fundingAvgPct == null,
      detail: `费率均值 ${fundingAvgPct == null ? '—' : fundingAvgPct.toFixed(4)}%`,
      weight: 0,
    },
    20,
  );
  pushRisk(
    {
      key: 'btcRisk',
      label: 'BTC 环境风险',
      met: btcEnv.maxDrawdown24hPct != null && btcEnv.maxDrawdown24hPct < -5,
      unknown: btcEnv.maxDrawdown24hPct == null,
      detail: `BTC 24h 回撤 ${fmtPct(btcEnv.maxDrawdown24hPct)}`,
      weight: 0,
    },
    10,
  );
  const riskScore = Math.round(Math.max(0, Math.min(100, riskVal)));
  const riskLayered: LayeredScore = { value: riskScore, status: 'COMPUTED' };

  // ---------------- 状态机 ----------------
  const failedBreakout = breakoutConfirmed && post.heldAboveBreakoutLevel === false;
  const retesting = breakoutConfirmed && post.retestedBreakoutLevel === true && post.heldAboveBreakoutLevel === true;

  const state = determineStateV2({
    hardVeto: hardVeto.kind,
    environmentGate: environment.gate,
    breakoutConfirmed,
    intradayAttempt,
    followThroughStatus: followThroughLayered.status,
    heldAboveBreakoutLevel: post.heldAboveBreakoutLevel,
    retesting,
    failedBreakout,
    invalidated,
    setupScore: setupScore,
  });

  const keyLevels: KeyLevels = {
    resistance: rollingHigh,
    breakoutLevel: breakoutConfirmed ? post.breakout!.level : null,
    invalidation: rollingHigh != null ? rollingHigh * 0.94 : null,
    ema20,
  };

  const features: FeatureVectorV2 = {
    compressionRatio: setup.compressionRatio,
    atrPercentile60d: setup.atrPercentile60d,
    volumeContractionRatio: setup.volumeContractionRatio,
    volumePercentile60d: setup.volumePercentile60d,
    distanceToResistancePct: setup.distanceToResistancePct,
    baseDurationCandles: setup.baseDurationCandles,
    higherLow: setup.higherLow,
    relativeStrengthPct: setup.relativeStrengthPct,
    relativeStrengthPercentile: setup.relativeStrengthPercentile,
    relativeStrengthSlope: setup.relativeStrengthSlope,
    aboveEma20: setup.aboveEma20,
    emaBullishStack: setup.emaBullishStack,
    preReturn7dPct: setup.preReturn7dPct,
    breakoutVolRatio: post.breakoutVolRatio,
    breakoutBodyStrength: post.breakoutBodyStrength,
    breakoutCloseLocation: post.breakoutCloseLocation,
    breakoutRelBtcPct: post.breakoutRelBtcPct,
    followThrough24hVolRatio: post.followThrough24hVolRatio,
    followThrough48hVolRatio: post.followThrough48hVolRatio,
    heldAboveBreakoutLevel: post.heldAboveBreakoutLevel,
    retestedBreakoutLevel: post.retestedBreakoutLevel,
    fundingAvgPct,
    fundingMaxPct,
    emaDistancePct,
    atrExpansionRatio,
  };

  const missingFields: string[] = [];
  const collectMissing = (items: ConditionItem[]) => items.filter((c) => c.unknown).forEach((c) => missingFields.push(c.key));

  collectMissing(setupScored.items);
  collectMissing(triggerConditions);
  collectMissing(followThroughConditions);
  collectMissing(riskFactors);

  return {
    asset,
    state,
    stateLabel: STATE_META[state].label,
    environment,
    setup: setupLayered,
    setupConditions: setupScored.items,
    trigger: triggerLayered,
    triggerConditions,
    followThrough: followThroughLayered,
    followThroughConditions,
    risk: riskLayered,
    riskFactors,
    hardVeto,
    breakout: {
      ts: post.breakout?.ts ?? null,
      level: post.breakout?.level ?? null,
      close: post.breakout?.close ?? null,
      distancePct: post.breakout?.distancePct ?? null,
      volumeRatio: post.breakoutVolRatio,
      confirmed: breakoutConfirmed,
      intradayAttempt,
      barsSinceBreakout: post.barsSinceBreakout,
      hoursSinceBreakout: post.hoursSinceBreakout,
    },
    keyLevels,
    features,
    dataQuality: {
      missingFields: Array.from(new Set(missingFields)),
      staleFields: [],
      degraded: missingFields.length > 0,
      summary: missingFields.length ? `${missingFields.length} 项条件因数据缺失不可判定` : '关键数据完整',
    },
  };
}
