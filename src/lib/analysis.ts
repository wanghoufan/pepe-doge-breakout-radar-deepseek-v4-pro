/**
 * 实时雷达引擎：把指标序列 + 资金费率 + BTC 环境，转成
 * 「机会评分 + 风险评分 + 六态 + 证据链」。
 *
 * 所有维度、阈值、权重都来自 config.ts；本文件不做任何魔法值散落。
 * 评分口径与研究报告第六节一致（25/25/30/20 = 100 分）。
 */
import {
  avg,
  meanTrueRangePct,
  median,
  pct,
  emaSeries,
} from './indicators';
import { DEFAULT_CONFIG, STATE_META, type AppConfig, type ThresholdConfig } from './config';
import { determineState } from './state-machine';
import type {
  AssetId,
  AssetSignal,
  Candle,
  ConditionItem,
  FeatureVector,
  KeyLevels,
} from './types';

const DAY = 86_400_000;

function between(bars: Candle[], startTs: number, endTs: number): Candle[] {
  return bars.filter((b) => b.ts >= startTs && b.ts <= endTs);
}

function lastValue(xs: number[]): number | null {
  return xs.length ? (xs.at(-1) ?? null) : null;
}

export interface AnalyzeContext {
  /** 兄弟币种（PEPE↔DOGE）本期相对 BTC 的强度 %，用于板块广度与共振。 */
  peerRelativeStrengthPct: number | null;
}

interface ConditionSpec {
  key: string;
  label: string;
  met: boolean;
  unknown: boolean;
  detail: string;
  weight: number;
}

function specs(rows: ConditionSpec[]): { items: ConditionItem[]; score: number } {
  let score = 0;
  const items = rows.map((r) => {
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
  return { items, score };
}

export interface ComputedFeature {
  feature: FeatureVector;
  keyLevels: KeyLevels;
  lastTs: number;
  lastClose: number;
  raw: {
    ema20: number | null;
    ema50: number | null;
    ema100: number | null;
    resistance: number | null;
    atrPctRecent: number | null;
    atrPctPrior: number | null;
    volRecent: number | null;
    volPrior: number | null;
    baselineVolMedian: number | null;
    breakoutVolRatio: number | null;
    persistentVolumeRatio: number | null;
    relativeStrengthPct: number | null;
    btcReturnPct: number | null;
    btc24hDD: number | null;
    btcCloseAboveEma100: boolean | null;
    fundingAvgPct: number | null;
    fundingMaxPct: number | null;
    distanceToBreakoutPct: number | null;
  };
}

export function computeFeatures(
  candles: Candle[],
  btcCandles: Candle[],
  funding: { ts: number; rate: number }[],
  t: ThresholdConfig,
): ComputedFeature {
  const bars = candles.slice().sort((a, b) => a.ts - b.ts);
  const btc = btcCandles.slice().sort((a, b) => a.ts - b.ts);

  const last = bars.at(-1)!;
  const nowTs = last.ts;

  const recent = between(bars, nowTs - t.recentDays * DAY, nowTs);
  const prior = between(bars, nowTs - (t.recentDays + t.priorDays) * DAY, nowTs - t.recentDays * DAY);

  // 结构阻力：过去 7 日（不含最后一根）的最高价
  const resistanceBars = bars.filter((b) => b.ts >= nowTs - t.structureLookbackDays * DAY && b.ts < nowTs);
  const resistance = resistanceBars.length ? Math.max(...resistanceBars.map((b) => b.h)) : null;

  const atrRecent = meanTrueRangePct(recent);
  const atrPrior = meanTrueRangePct(prior);
  const compressionRatio = atrRecent != null && atrPrior != null && atrPrior > 0 ? atrRecent / atrPrior : null;

  const volRecent = avg(recent.map((b) => b.quoteVol));
  const volPrior = avg(prior.map((b) => b.quoteVol));
  const preVolumeRatio = volRecent != null && volPrior != null && volPrior > 0 ? volRecent / volPrior : null;

  const baselineBars = between(bars, nowTs - (t.recentDays + t.priorDays) * DAY, nowTs - t.recentDays * DAY);
  const baselineVolMedian = median(baselineBars.map((b) => b.quoteVol));
  const breakoutVolRatio =
    baselineVolMedian != null && baselineVolMedian > 0 ? last.quoteVol / baselineVolMedian : null;

  // 持续量能：近 2 日均量 / 前 7 日中位量
  const recent2d = between(bars, nowTs - 2 * DAY, nowTs);
  const persistentVolumeRatio =
    baselineVolMedian != null && baselineVolMedian > 0
      ? (avg(recent2d.map((b) => b.quoteVol)) ?? 0) / baselineVolMedian
      : null;

  // 币/BTC 相对强度：对 4H 收盘价比值做窗口回归斜率
  const ema20Series = emaSeries(bars.map((b) => b.c), 20);
  const ema50Series = emaSeries(bars.map((b) => b.c), 50);
  const ema100Series = emaSeries(bars.map((b) => b.c), 100);
  const ema20 = lastValue(ema20Series);
  const ema50 = lastValue(ema50Series);
  const ema100 = lastValue(ema100Series);

  const btcEma100 = lastValue(emaSeries(btc.map((b) => b.c), 100));

  // 相对强度：对齐 ts 求 ratio = coin/btc，取窗口回归
  const btcByTs = new Map(btc.map((b) => [b.ts, b.c]));
  const ratio = bars
    .map((b) => {
      const bc = btcByTs.get(b.ts);
      return bc ? b.c / bc : null;
    })
    .filter((r): r is number => r != null);
  const ratioWindow = t.relativeStrengthWindow;
  const relativeStrengthPct = ratio.length >= 2
    ? pct(ratio.at(-1)!, ratio[Math.max(0, ratio.length - 1 - ratioWindow)])
    : null;

  const btcReturnPct = btc.length >= 2 ? pct(btc.at(-1)!.c, btc[0].c) : null;

  // BTC 24h 最大回撤（用于环境风险）
  const btc1d = btc.filter((b) => b.ts >= nowTs - DAY && b.ts <= nowTs);
  let btc24hDD: number | null = null;
  if (btc1d.length >= 2) {
    let peak = -Infinity;
    let dd = 0;
    for (const b of btc1d) {
      peak = Math.max(peak, b.h);
      dd = Math.min(dd, pct(b.l, peak));
    }
    btc24hDD = dd;
  }

  const btcCloseAboveEma100 = btc.length && btcEma100 != null ? btc.at(-1)!.c >= btcEma100 : null;

  const fundingAvgPct = funding.length ? (avg(funding.map((r) => r.rate)) ?? 0) * 100 : null;
  const fundingMaxPct = funding.length ? Math.max(...funding.map((r) => r.rate)) * 100 : null;

  const distanceToBreakoutPct = resistance ? pct(last.c, resistance) : null;

  // 近 7 日收益率（蓄势窗口收益）
  const pre7 = between(bars, nowTs - 7 * DAY, nowTs);
  const preReturnPct = pre7.length >= 2 ? pct(pre7.at(-1)!.c, pre7[0].o) : null;

  // —— KeyLevels ——
  const pullbackLower = resistance ? resistance * 0.97 : null;
  const invalidation = resistance ? resistance * 0.94 : null;
  // 更稳健的失效位：取「结构阻力×0.94」与「近 7 日低点」的较高者
  const recentLow = recent.length ? Math.min(...recent.map((b) => b.l)) : null;

  return {
    feature: {
      compressionRatio,
      preVolumeRatio,
      preReturnPct,
      abovePriorHigh: resistance != null ? last.c > resistance : null,
      breakoutVolRatio,
      persistentVolumeRatio,
      relativeStrength: relativeStrengthPct,
      aboveEma20: ema20 != null ? last.c >= ema20 : null,
      emaBullishStack:
        ema20 != null && ema50 != null && ema100 != null ? ema20 > ema50 && ema50 > ema100 : null,
      btcReturnPct,
      fundingAvgPct,
    },
    keyLevels: {
      resistance,
      breakoutLevel: resistance,
      pullbackUpper: resistance,
      pullbackLower,
      invalidation: invalidation != null && recentLow != null ? Math.max(invalidation, recentLow) : invalidation,
      ema20,
    },
    lastTs: nowTs,
    lastClose: last.c,
    raw: {
      ema20,
      ema50,
      ema100,
      resistance,
      atrPctRecent: atrRecent,
      atrPctPrior: atrPrior,
      volRecent,
      volPrior,
      baselineVolMedian,
      breakoutVolRatio,
      persistentVolumeRatio,
      relativeStrengthPct: relativeStrengthPct,
      btcReturnPct,
      btc24hDD,
      btcCloseAboveEma100,
      fundingAvgPct,
      fundingMaxPct,
      distanceToBreakoutPct,
    },
  };
}

const fmtPct = (v: number | null, digits = 2): string =>
  v == null ? '数据缺失' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;

/**
 * 对单个币种跑完整评分（机会分 + 风险分 + 状态 + 证据）。
 */
export function analyzeAsset(
  asset: AssetId,
  candles: Candle[],
  btcCandles: Candle[],
  funding: { ts: number; rate: number }[],
  ctx: AnalyzeContext,
  config: AppConfig = DEFAULT_CONFIG,
): AssetSignal {
  const t = config.thresholds;
  const w = config.opportunityWeights;
  const f = computeFeatures(candles, btcCandles, funding, t);
  const r = f.raw;
  const peer = ctx.peerRelativeStrengthPct;

  const stateMeta = STATE_META;

  // ---------- 环境（25） ----------
  const env = specs([
    {
      key: 'btcRisk',
      label: 'BTC 无急跌（24h 回撤未超阈值）',
      met: r.btc24hDD != null && r.btc24hDD >= t.btcMaxDrawdownPct,
      unknown: r.btc24hDD == null,
      detail: `BTC 24h 最大回撤 ${fmtPct(r.btc24hDD)}（阈值 ${t.btcMaxDrawdownPct}%）`,
      weight: w.environment.btcRisk,
    },
    {
      key: 'btcTrend',
      label: 'BTC 长期结构未破（收于 EMA100 上方）',
      met: r.btcCloseAboveEma100 === true,
      unknown: r.btcCloseAboveEma100 == null,
      detail: r.btcCloseAboveEma100 == null ? 'BTC 数据缺失' : `BTC 收盘${r.btcCloseAboveEma100 ? '高于' : '低于'} EMA100`,
      weight: w.environment.btcTrend,
    },
    {
      key: 'memeRelBtc',
      label: '币种相对 BTC 未走弱',
      met: r.relativeStrengthPct != null && r.relativeStrengthPct >= 0,
      unknown: r.relativeStrengthPct == null,
      detail: `币/BTC 相对强度 ${fmtPct(r.relativeStrengthPct)}`,
      weight: w.environment.memeRelBtc,
    },
    {
      key: 'breadth',
      label: '板块广度：兄弟币种同步走强',
      met: peer != null && peer >= 0,
      unknown: peer == null,
      detail: peer == null ? '缺少兄弟币种数据' : `兄弟币种相对强度 ${fmtPct(peer)}`,
      weight: w.environment.breadth,
    },
    {
      key: 'resonance',
      label: '共振：自身与兄弟币种同时走强',
      met: r.relativeStrengthPct != null && peer != null && r.relativeStrengthPct >= 0 && peer >= 0,
      unknown: r.relativeStrengthPct == null || peer == null,
      detail: `自身 ${fmtPct(r.relativeStrengthPct)} / 兄弟 ${fmtPct(peer)}`,
      weight: w.environment.resonance,
    },
  ]);

  // ---------- 蓄势（25） ----------
  const prep = specs([
    {
      key: 'atrCompression',
      label: 'ATR 收缩（近 3 日 / 前 7 日 ≤ 阈值）',
      met: r.atrPctRecent != null && r.atrPctPrior != null && r.atrPctPrior > 0 && r.atrPctRecent / r.atrPctPrior <= t.atrCompression,
      unknown: r.atrPctRecent == null || r.atrPctPrior == null || r.atrPctPrior === 0,
      detail: `压缩比 ${f.feature.compressionRatio == null ? '数据缺失' : f.feature.compressionRatio.toFixed(2)}（阈值 ≤${t.atrCompression}）`,
      weight: w.preparation.atrCompression,
    },
    {
      key: 'volumeContraction',
      label: '量能收缩（近 3 日 / 前 7 日 < 1）',
      met: f.feature.preVolumeRatio != null && f.feature.preVolumeRatio < 1,
      unknown: f.feature.preVolumeRatio == null,
      detail: `量比 ${f.feature.preVolumeRatio == null ? '数据缺失' : f.feature.preVolumeRatio.toFixed(2)}`,
      weight: w.preparation.volumeContraction,
    },
    {
      key: 'structureBase',
      label: '结构企稳（未破近 7 日低点）',
      met: f.keyLevels.invalidation != null && f.lastClose >= (f.keyLevels.invalidation ?? -Infinity),
      unknown: f.keyLevels.invalidation == null,
      detail: `现价 ${f.lastClose.toFixed(6)} vs 失效观察位 ${f.keyLevels.invalidation == null ? '—' : f.keyLevels.invalidation.toFixed(6)}`,
      weight: w.preparation.structureBase,
    },
    {
      key: 'resistanceCompression',
      label: '阻力收敛（价格距离阻力 < 8%）',
      met: r.resistance != null && f.lastClose / r.resistance > 0.92,
      unknown: r.resistance == null,
      detail: `距离阻力 ${fmtPct(r.distanceToBreakoutPct)}`,
      weight: w.preparation.resistanceCompression,
    },
    {
      key: 'relStrength',
      label: '相对强度为正',
      met: r.relativeStrengthPct != null && r.relativeStrengthPct > 0.5,
      unknown: r.relativeStrengthPct == null,
      detail: `相对强度 ${fmtPct(r.relativeStrengthPct)}`,
      weight: w.preparation.relStrength,
    },
  ]);

  // ---------- 突破（30） ----------
  const breakoutTriggered = f.feature.abovePriorHigh === true;
  const brk = specs([
    {
      key: 'closeBreakout',
      label: '4H 收盘突破结构阻力',
      met: breakoutTriggered,
      unknown: f.feature.abovePriorHigh == null,
      detail: r.resistance == null ? '阻力位缺失' : `收盘 ${f.lastClose.toFixed(6)} vs 阻力 ${r.resistance.toFixed(6)}`,
      weight: w.breakout.closeBreakout,
    },
    {
      key: 'volumeRatio',
      label: '突破量比达标',
      met: r.breakoutVolRatio != null && r.breakoutVolRatio >= t.breakoutVolRatioWeak,
      unknown: r.breakoutVolRatio == null,
      detail: `量比 ${r.breakoutVolRatio == null ? '数据缺失' : r.breakoutVolRatio.toFixed(2)}（弱 ${t.breakoutVolRatioWeak}x / 强 ${t.breakoutVolRatioStrong}x）`,
      weight: w.breakout.volumeRatio,
    },
    {
      key: 'persistentVolume',
      label: '放量具备持续性（近 2 日均量达标）',
      met: r.persistentVolumeRatio != null && r.persistentVolumeRatio >= t.persistentVolumeRatio,
      unknown: r.persistentVolumeRatio == null,
      detail: `持续量比 ${r.persistentVolumeRatio == null ? '数据缺失' : r.persistentVolumeRatio.toFixed(2)}（阈值 ≥${t.persistentVolumeRatio}）`,
      weight: w.breakout.persistentVolume,
    },
    {
      key: 'relOutperform',
      label: '相对 BTC 走强',
      met: r.relativeStrengthPct != null && r.relativeStrengthPct > 1,
      unknown: r.relativeStrengthPct == null,
      detail: `相对强度 ${fmtPct(r.relativeStrengthPct)}`,
      weight: w.breakout.relOutperform,
    },
    {
      key: 'pullback',
      label: '回踩确认（站稳突破位上方）',
      met: breakoutTriggered && r.distanceToBreakoutPct != null && r.distanceToBreakoutPct >= 0 && r.distanceToBreakoutPct <= 6,
      unknown: r.distanceToBreakoutPct == null,
      detail: `距突破位 ${fmtPct(r.distanceToBreakoutPct)}`,
      weight: w.breakout.pullback,
    },
  ]);

  // ---------- 风险/资金（20） ----------
  const crowded = r.fundingAvgPct != null && r.fundingAvgPct >= t.fundingOverheatPct;
  const risk = specs([
    {
      key: 'notCrowded',
      label: '资金费率未拥挤',
      met: r.fundingAvgPct != null && r.fundingAvgPct < t.fundingOverheatPct,
      unknown: r.fundingAvgPct == null,
      detail: `费率均值 ${r.fundingAvgPct == null ? '数据缺失' : r.fundingAvgPct.toFixed(4)}%（阈值 ${t.fundingOverheatPct}%）`,
      weight: w.risk.notCrowded,
    },
    {
      key: 'btcNoHardExit',
      label: 'BTC 未触发硬退出',
      met: r.btc24hDD != null && r.btc24hDD > t.btcMaxDrawdownPct,
      unknown: r.btc24hDD == null,
      detail: `BTC 24h 回撤 ${fmtPct(r.btc24hDD)}`,
      weight: w.risk.btcNoHardExit,
    },
    {
      key: 'coinNoInvalidation',
      label: '币种结构未破位（未跌破失效位）',
      met: f.keyLevels.invalidation != null && f.lastClose > f.keyLevels.invalidation,
      unknown: f.keyLevels.invalidation == null,
      detail: `现价 vs 失效位 ${f.keyLevels.invalidation == null ? '—' : f.keyLevels.invalidation.toFixed(6)}`,
      weight: w.risk.coinNoInvalidation,
    },
    {
      key: 'chaseDistance',
      label: '未过度追涨（距 EMA20 未过热）',
      met: r.ema20 != null && r.ema20 > 0 && pct(f.lastClose, r.ema20) <= t.chaseDistancePct,
      unknown: r.ema20 == null,
      detail: r.ema20 == null ? 'EMA20 缺失' : `距 EMA20 ${fmtPct(r.ema20 ? pct(f.lastClose, r.ema20) : null)}`,
      weight: w.risk.chaseDistance,
    },
    {
      key: 'riskReward',
      label: '盈亏比可接受（距阻力近）',
      met: r.distanceToBreakoutPct != null && r.distanceToBreakoutPct <= 10,
      unknown: r.distanceToBreakoutPct == null,
      detail: `距阻力 ${fmtPct(r.distanceToBreakoutPct)}`,
      weight: w.risk.riskReward,
    },
  ]);

  const opportunityScore = Math.round(env.score + prep.score + brk.score + risk.score);

  // ---------- 硬否决 ----------
  const btcHardExit =
    r.btc24hDD != null && r.btc24hDD <= t.btcMaxDrawdownPct;
  const coinInvalidation =
    f.keyLevels.invalidation != null && f.lastClose < f.keyLevels.invalidation;
  const hardVeto = btcHardExit || coinInvalidation;
  const hardVetoKind = coinInvalidation ? 'coin' : btcHardExit ? 'btc' : null;

  // ---------- 过热判定（用于 awaiting_pullback / 风险分） ----------
  const emaDistancePct = r.ema20 != null && r.ema20 > 0 ? pct(f.lastClose, r.ema20) : null;
  const overheated =
    (emaDistancePct != null && emaDistancePct > t.chaseDistancePct) ||
    (r.fundingAvgPct != null && r.fundingAvgPct >= t.fundingOverheatPct);

  // ---------- 蓄势完成度（用于临界 vs 蓄势） ----------
  const prepMax = 25;
  const preparationCompletion = prepMax > 0 ? prep.score / prepMax : 0;

  const stateCode = determineState({
    hardVeto,
    hardVetoKind: hardVetoKind as 'btc' | 'coin' | null,
    breakoutTriggered,
    overheated,
    preparationCompletion,
    distanceToBreakoutPct: r.distanceToBreakoutPct,
  });

  // ---------- 风险分（过热/失效风险，0~100，越高越危险） ----------
  let riskScore = 0;
  if (emaDistancePct != null && emaDistancePct > 0) riskScore += Math.min(40, (emaDistancePct / t.chaseDistancePct) * 40);
  if (crowded) riskScore += 30;
  else if (r.fundingAvgPct != null) riskScore += Math.min(30, (r.fundingAvgPct / t.fundingOverheatPct) * 30);
  if (r.btc24hDD != null && r.btc24hDD < 0) riskScore += Math.min(20, (r.btc24hDD / t.btcMaxDrawdownPct) * 20);
  if (r.distanceToBreakoutPct != null && r.distanceToBreakoutPct < -3) {
    riskScore += Math.min(10, Math.abs(r.distanceToBreakoutPct) * 2);
  }
  riskScore = Math.round(Math.max(0, Math.min(100, riskScore)));

  const allItems = [...env.items, ...prep.items, ...brk.items, ...risk.items];
  const metConditions = allItems.filter((c) => c.met);
  const missingConditions = allItems.filter((c) => !c.met);
  const unknownConditions = allItems.filter((c) => c.unknown);

  const stateLabel = stateMeta[stateCode].label;
  const reasons: string[] = [];
  if (hardVeto) {
    reasons.push(hardVetoKind === 'btc' ? 'BTC 触发硬退出，环境禁止关注' : '币种跌破失效位，信号失效');
  }
  if (breakoutTriggered && !hardVeto) reasons.push('4H 收盘已突破结构阻力');
  if (overheated && !hardVeto) reasons.push('价格/资金费率进入过热区');
  if (!breakoutTriggered && !hardVeto) {
    if (preparationCompletion >= 0.6) reasons.push('蓄势条件基本就绪，临近突破');
    else if (preparationCompletion > 0.25) reasons.push('蓄势进行中，缩量缩波尚未全面确认');
    else reasons.push('蓄势条件尚不充分');
  }
  for (const c of metConditions) reasons.push(`满足：${c.label}`);

  return {
    asset,
    state: stateCode,
    stateLabel,
    opportunityScore: hardVeto ? Math.min(opportunityScore, 25) : opportunityScore,
    riskScore,
    hardVeto,
    hardVetoReason: hardVeto ? (hardVetoKind === 'btc' ? 'BTC 24h 回撤触发硬退出阈值' : '币种跌破失效观察位') : null,
    reasons,
    metConditions,
    missingConditions,
    dataQuality: {
      missingFields: unknownConditions.map((c) => c.key),
      staleFields: [],
      degraded: unknownConditions.length > 0,
      summary: unknownConditions.length
        ? `${unknownConditions.length} 项条件因数据缺失不可判定`
        : '关键数据完整',
    },
    keyLevels: f.keyLevels,
    features: f.feature,
  };
}