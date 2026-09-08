/**
 * Independent Breakout Episode 构建器（V2 整改 §2–§6）。
 *
 * 问题：裸 rolling detector 在连续创新高行情中会连续打出多个 trigger
 * （约半数 trigger 间隔 ≤12H）。禁止把每个 trigger 当成独立历史事件。
 *
 * 本模块明确区分：
 * - Raw Trigger：单根 K 线满足 close > rollingHigh（`detectBreakoutAt`）。
 * - Independent Breakout Episode：一轮突破行情，只有一个 episode start；
 *   后续连续创新高 trigger 被吸收为同 episode 的第 2..N 个 trigger，
 *   直到发生 RESET 才能开启新 episode。
 *
 * 最高约束：构建过程严格 point-in-time、顺序推进，只用下标 ≤ i 的 K 线，
 * 实时 / 历史 / 回测共用 `buildBreakoutEpisodes`（同一 Episode Builder）。
 */

import { detectBreakoutAt, type BreakoutConfig, type BreakoutSignal } from '../breakout';
import { meanTrueRangePct } from '../indicators';
import type { Candle } from '../types';

/* ------------------------------------------------------------------ */
/* Episode 状态                                                        */
/* ------------------------------------------------------------------ */

/** IDLE → BASE → BREAKOUT_TRIGGERED → ACTIVE_BREAKOUT → RESET → IDLE
 * 注：Builder 只处理已收盘 K 线，episode 在 start trigger 收盘时直接进入 ACTIVE_BREAKOUT；
 * BREAKOUT_TRIGGERED 为保留态（供未来盘中未收盘试探使用），当前不产生。 */
export type EpisodeState = 'IDLE' | 'BASE' | 'BREAKOUT_TRIGGERED' | 'ACTIVE_BREAKOUT' | 'RESET';

export interface EpisodeTrigger {
  ts: number;
  index: number;
  close: number;
}

export interface BreakoutEpisode {
  /** `EP-<COIN>-<序号>`（序号按 startTs 升序）。 */
  id: string;
  coin: 'PEPE' | 'DOGE' | 'UNKNOWN';
  /** episode start trigger（第一个 trigger）的 ts / 下标 / 突破位 / 收盘价。 */
  startTs: number;
  startIndex: number;
  level: number;
  startClose: number;
  startVolumeRatio: number | null;
  startDistancePct: number;
  /** 本 episode 吸收的全部 raw triggers（含 start 在内，[0] 即 start）。 */
  triggers: EpisodeTrigger[];
  /** RESET 原因（仍 ACTIVE 则为 null）。 */
  resetReason: string | null;
  /** episode 最后一个被处理到的下标（含吸收期，用于 staleness 计算）。 */
  lastIndex: number;
  state: EpisodeState;
}

/* ------------------------------------------------------------------ */
/* Reset 规则                                                          */
/* ------------------------------------------------------------------ */

export type ResetRuleKind = 'cooldown' | 'return-to-range' | 'atr-base' | 'hybrid';

export interface EpisodeResetRule {
  kind: ResetRuleKind;
  /** 方案 A/D：最小间隔（根数，4H）。 */
  minCooldownBars: number;
  /** 方案 C：跌破 level 的 ATR 缓冲倍数。 */
  atrBufferMult: number;
  /** 方案 C/D：判定为 staleness 所需的无 trigger 根数。 */
  stalenessBars: number;
}

export const RESET_RULE_A_24H: EpisodeResetRule = { kind: 'cooldown', minCooldownBars: 6, atrBufferMult: 0.5, stalenessBars: 12 };
export const RESET_RULE_A_48H: EpisodeResetRule = { kind: 'cooldown', minCooldownBars: 12, atrBufferMult: 0.5, stalenessBars: 12 };
export const RESET_RULE_A_72H: EpisodeResetRule = { kind: 'cooldown', minCooldownBars: 18, atrBufferMult: 0.5, stalenessBars: 12 };
export const RESET_RULE_A_7D: EpisodeResetRule = { kind: 'cooldown', minCooldownBars: 42, atrBufferMult: 0.5, stalenessBars: 12 };
export const RESET_RULE_B_RANGE: EpisodeResetRule = { kind: 'return-to-range', minCooldownBars: 1, atrBufferMult: 0.5, stalenessBars: 12 };
export const RESET_RULE_C_ATR: EpisodeResetRule = { kind: 'atr-base', minCooldownBars: 6, atrBufferMult: 0.5, stalenessBars: 12 };

/**
 * 冻结规则（Hybrid D，见 BACKTEST_PROTOCOL_V1.md）：
 * - 距上一个 trigger 不足 6 根（24H）：一律吸收；
 * - 间隔 6–12 根：必须出现结构 reset（收盘跌回 level 下方）才开新 episode；
 * - 间隔 ≥12 根（48H 无新 trigger）：staleness，直接开新 episode。
 */
export const FROZEN_EPISODE_RULE: EpisodeResetRule = {
  kind: 'hybrid',
  minCooldownBars: 6,
  atrBufferMult: 0.5,
  stalenessBars: 12,
};

interface EpisodesBuildState {
  episodes: BreakoutEpisode[];
  open: BreakoutEpisode | null;
  /** open episode 建立后是否出现过收盘价 < level（return-to-range）。 */
  fellBelowLevel: boolean;
  /** open episode 建立时的 ATR 绝对值（方案 C 用）。 */
  startAtrAbs: number | null;
  state: EpisodeState;
}

function atrAbsAt(candles: Candle[], index: number): number | null {
  const slice = candles.slice(Math.max(0, index - 18), index);
  const pct = meanTrueRangePct(slice);
  if (pct == null || candles[index] == null) return null;
  return (pct / 100) * candles[index].c;
}

function openEpisode(
  coin: BreakoutEpisode['coin'],
  seq: number,
  sig: BreakoutSignal,
  candles: Candle[],
): { ep: BreakoutEpisode; startAtrAbs: number | null } {
  const ep: BreakoutEpisode = {
    id: `EP-${coin}-${String(seq).padStart(3, '0')}`,
    coin,
    startTs: sig.ts,
    startIndex: sig.index,
    level: sig.level,
    startClose: sig.close,
    startVolumeRatio: sig.volumeRatio,
    startDistancePct: sig.distancePct,
    triggers: [{ ts: sig.ts, index: sig.index, close: sig.close }],
    resetReason: null,
    lastIndex: sig.index,
    state: 'ACTIVE_BREAKOUT',
  };
  return { ep, startAtrAbs: atrAbsAt(candles, sig.index) };
}

/**
 * 单步推进（point-in-time）：用下标 index（含）之前的数据更新 episode 状态机。
 * 返回当前状态；调用方按顺序对每根 K 线调用即得到与 `buildBreakoutEpisodes` 一致的结果。
 * 对实时系统：每收盘一根调用一次，即可知道「当前 trigger 属于旧 episode 还是新 episode」，
 * 无需任何未来 K 线。
 */
export function updateBreakoutEpisode(
  candles: Candle[],
  index: number,
  build: EpisodesBuildState,
  config: BreakoutConfig,
  rule: EpisodeResetRule,
  coin: BreakoutEpisode['coin'],
  nextSeq: { value: number },
): EpisodeState {
  if (index < 0 || index >= candles.length) return build.state;
  // BASE：有足够历史但尚未有 episode。
  if (build.state === 'IDLE' && index >= config.lookbackCandles) build.state = 'BASE';

  const sig = detectBreakoutAt(candles, index, config);
  if (!sig) {
    // 无 trigger 时：检查 open episode 是否出现 return-to-range（只用 ≤index 数据）。
    if (build.open && candles[index].c < build.open.level) build.fellBelowLevel = true;
    return build.state;
  }

  const open = build.open;
  if (!open) {
    const { ep, startAtrAbs } = openEpisode(coin, nextSeq.value++, sig, candles);
    build.episodes.push(ep);
    build.open = ep;
    build.fellBelowLevel = false;
    build.startAtrAbs = startAtrAbs;
    build.state = 'ACTIVE_BREAKOUT';
    return build.state;
  }

  // 已有 open episode：判定 RESET（只用下标 ≤ index 的数据）。
  if (candles[index].c < open.level) build.fellBelowLevel = true;
  const gapSinceLastTrigger = index - open.triggers[open.triggers.length - 1].index;
  const gapSinceStart = index - open.startIndex;

  let shouldReset = false;
  let reason = '';
  switch (rule.kind) {
    case 'cooldown':
      shouldReset = gapSinceLastTrigger > rule.minCooldownBars;
      reason = `cooldown(${rule.minCooldownBars} bars)`;
      break;
    case 'return-to-range':
      shouldReset = build.fellBelowLevel && gapSinceLastTrigger > rule.minCooldownBars;
      reason = 'return-to-range';
      break;
    case 'atr-base': {
      const lostLevel =
        build.startAtrAbs != null
          ? candles[index].c < open.level - rule.atrBufferMult * build.startAtrAbs
          : build.fellBelowLevel;
      const stale = gapSinceStart >= 42 && gapSinceLastTrigger >= rule.stalenessBars;
      shouldReset = (lostLevel || stale) && gapSinceLastTrigger > rule.minCooldownBars;
      reason = lostLevel ? 'atr-base(lost-level)' : 'atr-base(stale)';
      break;
    }
    case 'hybrid': {
      if (gapSinceLastTrigger < rule.minCooldownBars) {
        shouldReset = false;
      } else if (gapSinceLastTrigger >= rule.stalenessBars) {
        shouldReset = true;
        reason = 'hybrid(staleness-48H)';
      } else {
        shouldReset = build.fellBelowLevel;
        reason = 'hybrid(return-to-range)';
      }
      break;
    }
  }

  if (shouldReset) {
    open.state = 'RESET';
    open.resetReason = reason;
    open.lastIndex = index - 1;
    const { ep, startAtrAbs } = openEpisode(coin, nextSeq.value++, sig, candles);
    build.episodes.push(ep);
    build.open = ep;
    build.fellBelowLevel = false;
    build.startAtrAbs = startAtrAbs;
    build.state = 'ACTIVE_BREAKOUT';
  } else {
    open.triggers.push({ ts: sig.ts, index: sig.index, close: sig.close });
    open.lastIndex = index;
  }
  return build.state;
}

function freshBuildState(): EpisodesBuildState {
  return { episodes: [], open: null, fellBelowLevel: false, startAtrAbs: null, state: 'IDLE' };
}

/**
 * 构建全量 Independent Breakout Episodes（历史扫描 / 回测 / 实时共用）。
 * 顺序扫描、严格 point-in-time：下标 i 的归属判定只用 candles[0..i]。
 */
export function buildBreakoutEpisodes(
  candles: Candle[],
  config: BreakoutConfig,
  rule: EpisodeResetRule = FROZEN_EPISODE_RULE,
  coin: BreakoutEpisode['coin'] = 'UNKNOWN',
): BreakoutEpisode[] {
  const sorted = candles.slice().sort((a, b) => a.ts - b.ts);
  const build = freshBuildState();
  const nextSeq = { value: 1 };
  // 注意：detectBreakoutAt 用的是下标；排序后下标与输入一致（调用方须保证已排序）。
  for (let i = 0; i < sorted.length; i++) {
    updateBreakoutEpisode(sorted, i, build, config, rule, coin, nextSeq);
  }
  if (build.open && build.open.state === 'ACTIVE_BREAKOUT') {
    build.open.lastIndex = sorted.length - 1;
  }
  return build.episodes;
}

/** 统计口径对照：raw trigger 数 vs independent episode 数。 */
export function summarizeRawVsIndependent(
  candles: Candle[],
  config: BreakoutConfig,
  rule: EpisodeResetRule = FROZEN_EPISODE_RULE,
  coin: BreakoutEpisode['coin'] = 'UNKNOWN',
): {
  rawTriggers: number;
  episodes: number;
  triggersPerEpisode: number[];
  mean: number | null;
  median: number | null;
  p90: number | null;
  max: number | null;
  episodeGapBars: number[];
} {
  const sorted = candles.slice().sort((a, b) => a.ts - b.ts);
  let raw = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (detectBreakoutAt(sorted, i, config)) raw++;
  }
  const eps = buildBreakoutEpisodes(sorted, config, rule, coin);
  const tpe = eps.map((e) => e.triggers.length).sort((a, b) => a - b);
  const gaps = eps.slice(1).map((e, k) => e.startIndex - eps[k].startIndex);
  const q = (arr: number[], p: number): number | null => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  };
  return {
    rawTriggers: raw,
    episodes: eps.length,
    triggersPerEpisode: tpe,
    mean: tpe.length ? tpe.reduce((a, b) => a + b, 0) / tpe.length : null,
    median: q(tpe, 50),
    p90: q(tpe, 90),
    max: tpe.length ? tpe[tpe.length - 1] : null,
    episodeGapBars: gaps,
  };
}

/**
 * 实时归属判定：给定当前已收盘序列，返回最近一个 trigger 属于哪个 episode、
 * 是 episode start 还是被吸收的第 N 个 trigger。实时链路每收盘调用一次即可，
 * 与历史扫描是同一 Builder（TEST 13 覆盖）。
 */
export function getRealtimeEpisodeMembership(
  candles: Candle[],
  config: BreakoutConfig,
  rule: EpisodeResetRule = FROZEN_EPISODE_RULE,
  coin: BreakoutEpisode['coin'] = 'UNKNOWN',
): {
  episodeId: string | null;
  triggerIndexInEpisode: number | null;
  triggersInEpisode: number | null;
  isEpisodeStart: boolean | null;
} {
  if (!candles.length) {
    return { episodeId: null, triggerIndexInEpisode: null, triggersInEpisode: null, isEpisodeStart: null };
  }
  const eps = buildBreakoutEpisodes(candles, config, rule, coin);
  const lastTs = candles[candles.length - 1].ts;
  // 找到包含「最后一个 trigger」的 episode（trigger ts ≤ lastTs）。
  let hit: BreakoutEpisode | null = null;
  let hitIdx = -1;
  for (const ep of eps) {
    for (let k = 0; k < ep.triggers.length; k++) {
      if (ep.triggers[k].ts <= lastTs) {
        hit = ep;
        hitIdx = k;
      }
    }
  }
  if (!hit) {
    return { episodeId: null, triggerIndexInEpisode: null, triggersInEpisode: null, isEpisodeStart: null };
  }
  return {
    episodeId: hit.id,
    triggerIndexInEpisode: hitIdx + 1,
    triggersInEpisode: hit.triggers.length,
    isEpisodeStart: hitIdx === 0,
  };
}
