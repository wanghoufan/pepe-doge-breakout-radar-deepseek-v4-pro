/**
 * Walk-forward 回测（V2，Phase 6）。
 *
 * 严格时间序列回测：Train 用较早历史、Validation 用中间、Test 用最新历史，
 * 滚动推进。禁止「拿全部历史挑完规则再拿全部历史证明规则有效」。
 *
 * 拆分口径：按时间（campaign 级）拆分，同一轮行情（PEPE+DOGE）天然落在同一段，
 * 不会出现 PEPE 在训练集、DOGE 在测试集的市场环境泄漏。
 */
import { DEFAULT_CONFIG } from '../config';
import { CAMPAIGNS } from '../event-analysis';
import { emaSeries } from '../indicators';
import type { Candle, EnvironmentGate } from '../types';
import {
  computeBtcEnvironment,
  computeSetupFeatures,
  evaluateEnvironment,
  evaluateHardVeto,
  scoreSetupLayer,
} from './engine';
import { FROZEN_PROTOCOL, checkProtocolCompliance } from './protocol';
import type { BreakoutEpisode } from './episode';
import type { OutcomeMetrics } from './outcomes';
import { classifyHistoricalOutcome, FROZEN_SUCCESS_LABEL, type SuccessLabel } from './outcomes';
import type { BreakoutSample } from './samples';

export interface BacktestMetrics {
  total: number;
  positives: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  fpr: number | null;
  successRate: number | null;
  f1: number | null;
  avgMfe72h: number | null;
  avgMae72h: number | null;
}

export interface SignalRule {
  volumeThreshold: number;
  distanceThreshold: number;
}

/** 信号规则：突破样本的 volumeRatio ≥ 阈值 且 突破距离 ≥ 阈值。 */
export function makeSignalFn(rule: SignalRule): (s: BreakoutSample) => boolean {
  return (s) => {
    const volOk = s.volumeRatio != null && s.volumeRatio >= rule.volumeThreshold;
    const distOk = s.distancePct >= rule.distanceThreshold;
    return volOk && distOk;
  };
}

export function computeMetrics(samples: BreakoutSample[], signal: (s: BreakoutSample) => boolean): BacktestMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const positives: BreakoutSample[] = [];
  let sumMfe = 0;
  let sumMae = 0;
  let nPos = 0;

  for (const s of samples) {
    if (s.outcome == null) continue; // 无法标签的样本不计入
    const sig = signal(s);
    const isSuccess = s.outcome === 'success';
    if (sig) {
      positives.push(s);
      if (s.mfe72h != null) {
        sumMfe += s.mfe72h;
        sumMae += s.mae72h ?? 0;
        nPos++;
      }
    }
    if (sig && isSuccess) tp++;
    else if (sig && !isSuccess) fp++;
    else if (!sig && isSuccess) fn++;
    else tn++;
  }

  const total = tp + fp + fn + tn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;

  return {
    total,
    positives: tp + fp,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    fpr,
    successRate: precision,
    f1,
    avgMfe72h: nPos ? sumMfe / nPos : null,
    avgMae72h: nPos ? sumMae / nPos : null,
  };
}

export interface WalkForwardFold {
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
  chosenRule: SignalRule;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
}

/** 候选信号规则（阈值在训练集上调优，测试集只评估一次）。 */
const CANDIDATE_RULES: SignalRule[] = [
  { volumeThreshold: 1.0, distanceThreshold: 0 },
  { volumeThreshold: 1.5, distanceThreshold: 0 },
  { volumeThreshold: 2.0, distanceThreshold: 0 },
  { volumeThreshold: 3.0, distanceThreshold: 0 },
  { volumeThreshold: 1.0, distanceThreshold: 0.5 },
  { volumeThreshold: 1.5, distanceThreshold: 0.5 },
  { volumeThreshold: 2.0, distanceThreshold: 0.5 },
  { volumeThreshold: 2.0, distanceThreshold: 1.0 },
  { volumeThreshold: 3.0, distanceThreshold: 1.0 },
];

/**
 * 滚动 walk-forward：把样本按时间切成 nFolds 段，逐段推进：
 *   fold k 的训练集 = folds[0..k-1]，测试集 = folds[k]。
 * 每个 fold 在训练集上按 F1 选最优规则，再在测试集上只评估一次。
 */
export function walkForwardBacktest(samples: BreakoutSample[], nFolds = 5): WalkForwardFold[] {
  const sorted = samples.slice().sort((a, b) => a.ts - b.ts);
  const folds: BreakoutSample[][] = [];
  const size = Math.ceil(sorted.length / nFolds);
  for (let i = 0; i < nFolds; i++) {
    folds.push(sorted.slice(i * size, (i + 1) * size));
  }
  folds.filter((f) => f.length > 0);

  const results: WalkForwardFold[] = [];
  for (let k = 1; k < folds.length; k++) {
    const train = folds.slice(0, k).flat();
    const test = folds[k];

    // 在训练集上选最优规则（F1）
    let best: SignalRule = CANDIDATE_RULES[0];
    let bestF1 = -1;
    for (const rule of CANDIDATE_RULES) {
      const m = computeMetrics(train, makeSignalFn(rule));
      if (m.f1 != null && m.f1 > bestF1) {
        bestF1 = m.f1;
        best = rule;
      }
    }

    const trainMetrics = computeMetrics(train, makeSignalFn(best));
    const testMetrics = computeMetrics(test, makeSignalFn(best));
    results.push({
      trainFrom: train[0]?.ts ?? 0,
      trainTo: train.at(-1)?.ts ?? 0,
      testFrom: test[0]?.ts ?? 0,
      testTo: test.at(-1)?.ts ?? 0,
      chosenRule: best,
      trainMetrics,
      testMetrics,
    });
  }
  return results;
}

/**
 * 汇总所有 fold 的测试集表现（把各 fold 的 test 结果合并）。
 */
export function summarizeWalkForward(folds: WalkForwardFold[]): BacktestMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const f of folds) {
    tp += f.testMetrics.tp;
    fp += f.testMetrics.fp;
    fn += f.testMetrics.fn;
    tn += f.testMetrics.tn;
  }
  const total = tp + fp + fn + tn;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return {
    total,
    positives: tp + fp,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    fpr,
    successRate: precision,
    f1,
    avgMfe72h: null,
    avgMae72h: null,
  };
}

/* ================================================================== */
/* V2 整改 §14–§18：Episode 级增量回测 + Campaign Walk-Forward          */
/* ================================================================== *
 *
 * 动机：裸 rolling breakout 约 33–35% 成功率只能当 Baseline，
 * 不能用来描述「V2 策略效果」。本节比较：
 *   B0 = 无策略（仅 prevalence 基准行，不发信号）
 *   B1 = Rolling 7D Breakout（全部 episodes，裸信号）
 *   M1 = B1 + Breakout Volume
 *   M2 = Environment + Setup + Trigger
 *   M3 = M2 + Risk
 *   M4 = M3 + Hard Veto
 *   M5 = M4 + Follow-through Management（突破后管理，单独评价）
 *
 * 全部特征严格 point-in-time（episode start 时刻已知数据）；
 * outcome label 只用于评估，不参与信号。
 */

/** Episode 级特征行（point-in-time 特征 + 事后 outcome 并列存放）。 */
export interface EpisodeFeatureRow {
  episodeId: string;
  coin: 'PEPE' | 'DOGE' | 'UNKNOWN';
  ts: number;
  level: number;
  close: number;
  volumeRatio: number | null;
  distancePct: number;
  /** 突破前前缀算出的 Setup 分（与实时引擎同一 scoreSetupLayer）。 */
  setupScore: number | null;
  envGate: EnvironmentGate;
  bodyStrength: number | null;
  fakeWick: boolean | null;
  /** 与实时引擎同口径的风险点数（chase40/shortGain15/atrExp15/crowded20/btcRisk10）。 */
  riskPoints: number;
  riskUnknown: boolean;
  /** trigger 时刻的硬否决。 */
  vetoKind: string;
  /** 突破后 24h 跟随确认（管理逻辑，用突破后数据；null = 数据不足）。 */
  ft24Confirmed: boolean | null;
  /** 事后标签（仅评估用）。 */
  outcome: 'success' | 'failure' | null;
  mfe72h: number | null;
  mae72h: number | null;
  mfe7d: number | null;
  mae7d: number | null;
  ret72h: number | null;
  ret7d: number | null;
  campaign: string;
}

export interface FeatureBuildInput {
  coin: 'PEPE' | 'DOGE' | 'UNKNOWN';
  /** 已按 ts 升序。episodes 必须由同一数组构建（下标/时间戳对齐）。 */
  bars: Candle[];
  btcBars: Candle[];
  funding: { ts: number; rate: number }[];
  episodes: BreakoutEpisode[];
  outcomesByEpisodeId: Map<string, OutcomeMetrics>;
  label?: SuccessLabel;
}

/** 按 trigger 时刻把 episode 归入 campaign（ Burg：只用 trigger ts，不看未来）。 */
export function episodeCampaignOf(ts: number): string {
  for (const c of CAMPAIGNS) {
    const s = Date.parse(c.startIso);
    const e = Date.parse(c.endIso);
    if (ts >= s && ts <= e) return c.campaignId;
  }
  const d = new Date(ts);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `GAP-${d.getUTCFullYear()}-Q${q}`;
}

function medianOf(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 为每个 episode 构建 point-in-time 特征行。
 * - Setup：只用突破前前缀 `bars[0..triggerIdx-1]`（严格早于突破）。
 * - Trigger（量比/距离/实体）：突破 K 线收盘时已知。
 * - Risk/Environment/Veto：trigger 时刻已知。
 * - Follow-through / Outcome：突破后数据，仅用于管理与评估。
 */
export function buildEpisodeFeatureRows(input: FeatureBuildInput): EpisodeFeatureRow[] {
  const t = DEFAULT_CONFIG.thresholds;
  const w = DEFAULT_CONFIG.weights;
  const label = input.label ?? FROZEN_SUCCESS_LABEL;
  const bars = input.bars.slice().sort((a, b) => a.ts - b.ts);
  const btc = input.btcBars.slice().sort((a, b) => a.ts - b.ts);
  const idxByTs = new Map(bars.map((b, i) => [b.ts, i]));

  return input.episodes.map((ep) => {
    const tri = idxByTs.get(ep.startTs) ?? -1;
    const pre = tri >= 0 ? bars.slice(0, tri) : [];
    const upTo = tri >= 0 ? bars.slice(0, tri + 1) : [];
    const btcPre = btc.filter((b) => b.ts <= ep.startTs);
    const fundPre = input.funding.filter((f) => f.ts <= ep.startTs).slice(-8);

    const setup = pre.length ? computeSetupFeatures(pre, btcPre, t) : null;
    const scored = setup ? scoreSetupLayer(setup, t, w) : null;
    const setupScore =
      scored && scored.available > 0 ? Math.round(Math.max(0, Math.min(100, (scored.score / scored.available) * 100))) : null;

    const btcEnv = computeBtcEnvironment(btcPre, t);
    const env = evaluateEnvironment(btcEnv, null);

    const bar = tri >= 0 ? bars[tri] : null;
    const range = bar ? bar.h - bar.l : 0;
    const bodyStrength = bar && range > 0 ? Math.abs(bar.c - bar.o) / range : null;
    const fakeWick = bar && range > 0 ? (bar.h - bar.c) / range > 0.5 : null;

    // 与实时引擎同口径的风险点数（trigger 时刻已知量）。
    let riskPoints = 0;
    let riskUnknown = false;
    const ema20pre = pre.length ? (emaSeries(pre.map((b) => b.c), 20).at(-1) ?? null) : null;
    const emaDist = ema20pre != null && ema20pre > 0 && bar ? ((bar.c / ema20pre - 1) * 100) : null;
    if (emaDist == null) riskUnknown = true;
    else if (emaDist > t.chaseDistancePct) riskPoints += 40;
    const preRet = setup?.preReturn7dPct ?? null;
    if (preRet == null) riskUnknown = true;
    else if (preRet > 40) riskPoints += 15;
    const atrExp = setup?.compressionRatio != null ? 1 / setup.compressionRatio : null;
    if (atrExp == null) riskUnknown = true;
    else if (atrExp >= t.atrExpansionRisk) riskPoints += 15;
    const fundAvg = fundPre.length ? fundPre.reduce((a, f) => a + f.rate, 0) / fundPre.length * 100 : null;
    if (fundAvg == null) riskUnknown = true;
    else if (fundAvg >= t.fundingOverheatPct) riskPoints += 20;
    const btcDd = btcEnv.maxDrawdown24hPct;
    if (btcDd == null) riskUnknown = true;
    else if (btcDd < -5) riskPoints += 10;

    // trigger 时刻的结构 invalidated 传 false（硬编码）：回测在 trigger 时刻本就不该知道
    // 未来是否跌破失效位，故 STRUCTURE_VETO 在此永不触发；M4 相对 M3 的实际增量
    // 仅剩 BTC_VETO / DATA_VETO。解读 M4 时必须如实说明，不得暗示含结构失效过滤。
    const veto = upTo.length
      ? evaluateHardVeto(upTo, btcEnv, false, t).kind
      : 'DATA_VETO';

    // Follow-through 管理（突破后 24h = 6 根）：站稳 + 量能持续。
    let ft24Confirmed: boolean | null = null;
    if (tri >= 0) {
      const post24 = bars.slice(tri + 1, tri + 7);
      if (post24.length >= 6) {
        const baseline = bars.slice(Math.max(0, tri - t.breakoutLookbackCandles), tri).map((b) => b.quoteVol);
        const med = medianOf(baseline);
        const held = post24[post24.length - 1].c > ep.level;
        const volOk = med != null && med > 0
          ? post24.reduce((a, b) => a + b.quoteVol, 0) / post24.length / med >= t.followThroughVolRatio
          : false;
        ft24Confirmed = held && volOk;
      }
    }

    const om = input.outcomesByEpisodeId.get(ep.id);
    const outcome = om ? classifyHistoricalOutcome(om, label) : null;

    return {
      episodeId: ep.id,
      coin: input.coin,
      ts: ep.startTs,
      level: ep.level,
      close: ep.startClose,
      volumeRatio: ep.startVolumeRatio,
      distancePct: ep.startDistancePct,
      setupScore,
      envGate: env.gate,
      bodyStrength,
      fakeWick,
      riskPoints,
      riskUnknown,
      vetoKind: veto,
      ft24Confirmed,
      outcome,
      mfe72h: om?.windows['72h']?.mfe ?? null,
      mae72h: om?.windows['72h']?.mae ?? null,
      mfe7d: om?.windows['168h']?.mfe ?? null,
      mae7d: om?.windows['168h']?.mae ?? null,
      ret72h: om?.windows['72h']?.breakoutReturn ?? null,
      ret7d: om?.windows['168h']?.breakoutReturn ?? null,
      campaign: episodeCampaignOf(ep.startTs),
    };
  });
}

/* ---------------- 增量模型 ---------------- */

export type IncrementalModelId = 'B0' | 'B1' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5';

export const MODEL_DEFS: { id: IncrementalModelId; label: string; desc: string }[] = [
  { id: 'B0', label: 'Baseline 0（无策略）', desc: '不发信号，仅报告 prevalence 基准' },
  { id: 'B1', label: 'Baseline 1（裸 Rolling 突破）', desc: '全部 episodes 发信号' },
  { id: 'M1', label: 'Model 1（+Breakout Volume）', desc: '裸突破 + volumeRatio ≥ 阈值' },
  { id: 'M2', label: 'Model 2（Env+Setup+Trigger）', desc: 'env≠BLOCK 且 setupScore≥阈值 且 量比/距离达标' },
  { id: 'M3', label: 'Model 3（+Risk）', desc: 'M2 + 无假突破结构 + 风险点数 ≤ 上限' },
  { id: 'M4', label: 'Model 4（+Hard Veto）', desc: 'M3 + trigger 时刻无硬否决' },
  { id: 'M5', label: 'Model 5（+Follow-through 管理）', desc: 'M4 + 突破后 24h 跟随确认' },
];

export interface IncrementalParams {
  volumeMin: number;
  setupMin: number;
  distanceMin: number;
  riskMax: number;
}

export function makeIncrementalSignal(
  model: IncrementalModelId,
  p: IncrementalParams,
): (r: EpisodeFeatureRow) => boolean {
  switch (model) {
    case 'B0':
      return () => false;
    case 'B1':
      return () => true;
    case 'M1':
      return (r) => r.volumeRatio != null && r.volumeRatio >= p.volumeMin;
    case 'M2':
      return (r) =>
        r.envGate !== 'BLOCK' &&
        r.setupScore != null && r.setupScore >= p.setupMin &&
        r.volumeRatio != null && r.volumeRatio >= p.volumeMin &&
        r.distancePct >= p.distanceMin;
    case 'M3':
      return (r) =>
        makeIncrementalSignal('M2', p)(r) &&
        r.fakeWick !== true &&
        !r.riskUnknown &&
        r.riskPoints <= p.riskMax;
    case 'M4':
      return (r) => makeIncrementalSignal('M3', p)(r) && r.vetoKind === 'NONE';
    case 'M5':
      return (r) => makeIncrementalSignal('M4', p)(r) && r.ft24Confirmed === true;
  }
}

/** 模型连续分（仅 M1/M2 有自然排序分；其余为二元过滤，AUC 记 N/A）。 */
export function incrementalScore(model: IncrementalModelId, r: EpisodeFeatureRow): number | null {
  if (model === 'M1') return r.volumeRatio;
  if (model === 'M2') return r.setupScore;
  return null;
}

export interface IncrementalMetrics {
  labeled: number;
  signals: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  specificity: number | null;
  fpr: number | null;
  fnr: number | null;
  f1: number | null;
  prAuc: number | null;
  rocAuc: number | null;
  aucNote: string | null;
  medianMfe: number | null;
  medianMae: number | null;
  medianReturn: number | null;
  signalsPerMonth: number | null;
  baseRate: number | null;
}

function medianOfNull(xs: (number | null)[]): number | null {
  const v = xs.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Mann-Whitney 秩 AUC（scores 越高越可能是 success）。 */
function rankAuc(scores: number[], labels: boolean[]): number | null {
  if (scores.length !== labels.length || scores.length < 2) return null;
  const nPos = labels.filter(Boolean).length;
  const nNeg = labels.length - nPos;
  if (!nPos || !nNeg) return null;
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  for (let r = 0; r < order.length; r++) {
    if (labels[order[r].i]) rankSum += r + 1;
  }
  return (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

function prAucFromScores(scores: number[], labels: boolean[]): number | null {
  if (scores.length < 2) return null;
  const nPos = labels.filter(Boolean).length;
  if (!nPos || nPos === labels.length) return null;
  const order = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s);
  let tp = 0;
  let fp = 0;
  let prevRecall = 0;
  let auc = 0;
  for (const o of order) {
    if (labels[o.i]) tp++;
    else fp++;
    const recall = tp / nPos;
    const precision = tp / (tp + fp);
    auc += precision * (recall - prevRecall);
    prevRecall = recall;
  }
  return auc;
}

export function computeIncrementalMetrics(
  rows: EpisodeFeatureRow[],
  signal: (r: EpisodeFeatureRow) => boolean,
  scoreFn: ((r: EpisodeFeatureRow) => number | null) | null,
): IncrementalMetrics {
  const labeled = rows.filter((r) => r.outcome != null);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const sigMfe: (number | null)[] = [];
  const sigMae: (number | null)[] = [];
  const sigRet: (number | null)[] = [];
  const scores: number[] = [];
  const scoreLabels: boolean[] = [];
  const sigTs: number[] = [];
  for (const r of labeled) {
    const s = signal(r);
    const ok = r.outcome === 'success';
    if (s && ok) tp++;
    else if (s && !ok) fp++;
    else if (!s && ok) fn++;
    else tn++;
    if (s) {
      sigMfe.push(r.mfe72h);
      sigMae.push(r.mae72h);
      sigRet.push(r.ret72h);
      sigTs.push(r.ts);
    }
    if (scoreFn) {
      const sc = scoreFn(r);
      if (sc != null) {
        scores.push(sc);
        scoreLabels.push(ok);
      }
    }
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : null;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : null;
  const fnr = fn + tp > 0 ? fn / (fn + tp) : null;
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  const baseRate = labeled.length ? labeled.filter((r) => r.outcome === 'success').length / labeled.length : null;
  let months: number | null = null;
  if (sigTs.length >= 2) {
    months = (Math.max(...sigTs) - Math.min(...sigTs)) / (30.44 * 86_400_000);
    if (!(months > 0)) months = null;
  }
  return {
    labeled: labeled.length,
    signals: tp + fp,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    specificity,
    fpr,
    fnr,
    f1,
    prAuc: scoreFn ? prAucFromScores(scores, scoreLabels) : null,
    rocAuc: scoreFn ? rankAuc(scores, scoreLabels) : null,
    aucNote: scoreFn ? null : '二元过滤模型无自然排序分，AUC 不适用',
    medianMfe: medianOfNull(sigMfe),
    medianMae: medianOfNull(sigMae),
    medianReturn: medianOfNull(sigRet),
    signalsPerMonth: months != null ? (tp + fp) / months : (tp + fp > 0 ? tp + fp : null),
    baseRate,
  };
}

/* ---------------- Campaign 级 Walk-Forward ---------------- */

export interface CampaignFold {
  name: string;
  trainCampaigns: string[];
  testCampaigns: string[];
  trainFrom: number;
  trainTo: number;
  testFrom: number;
  testTo: number;
}

export interface IncrementalModelResult {
  model: IncrementalModelId;
  /** 在 train 上按 F1 选出的参数（B0/B1 无参数则为 null）。 */
  chosen: IncrementalParams | null;
  trainMetrics: IncrementalMetrics;
  testMetrics: IncrementalMetrics;
  gridsUsed: { volumeRatio: number[]; setupScore: number[]; distancePct: number[]; riskMax: number[] };
  selectedOnTrainOnly: true;
}

export interface CampaignFoldResult extends CampaignFold {
  models: IncrementalModelResult[];
}

/**
 * Campaign-Level Walk Forward（§18）：
 * - 先把 episodes 按 campaign 分组（campaign 外按季度 GAP 分组），组内按时间排序；
 * - 组按时间顺序累积成 nFolds 个时间段，fold 边界只落在组之间
 *   → 同一 campaign 永不跨 train/test；
 * - 每个 fold：expanding train（之前全部段）+ test（下一段），
 *   参数在 train 上按 F1 选择，test 只评估一次。
 */
export function campaignWalkForward(
  rows: EpisodeFeatureRow[],
  nFolds = 4,
  grids: { volumeRatio: number[]; setupScore: number[]; distancePct: number[]; riskMax: number[] } = FROZEN_PROTOCOL.grids,
): { folds: CampaignFoldResult[]; compliance: { compliant: boolean; violations: string[] } } {
  const compliance = checkProtocolCompliance(grids);
  const labeled = rows.filter((r) => r.outcome != null).sort((a, b) => a.ts - b.ts);
  const byCampaign = new Map<string, EpisodeFeatureRow[]>();
  for (const r of labeled) {
    if (!byCampaign.has(r.campaign)) byCampaign.set(r.campaign, []);
    byCampaign.get(r.campaign)!.push(r);
  }
  const groups = [...byCampaign.entries()].sort((a, b) => a[1][0].ts - b[1][0].ts);
  const n = Math.max(2, Math.min(nFolds, groups.length - 1));
  // 按组数均衡切成 n 个非空时间段（边界只在组之间）。
  const segs: string[][] = [];
  const base = Math.floor(groups.length / n);
  const rem = groups.length % n;
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const size = base + (i < rem ? 1 : 0);
    segs.push(groups.slice(cursor, cursor + size).map(([k]) => k));
    cursor += size;
  }
  const segRows = segs.map((keys) => keys.flatMap((k) => byCampaign.get(k)!));

  const modelIds: IncrementalModelId[] = ['B0', 'B1', 'M1', 'M2', 'M3', 'M4', 'M5'];
  const folds: CampaignFoldResult[] = [];
  for (let k = 0; k < segs.length - 1; k++) {
    const train = segRows.slice(0, k + 1).flat();
    const test = segRows[k + 1];
    const trainCampaigns = segs.slice(0, k + 1).flat();
    const testCampaigns = segs[k + 1];
    const fold: CampaignFoldResult = {
      name: `fold-${k + 1}`,
      trainCampaigns,
      testCampaigns,
      trainFrom: train[0]?.ts ?? 0,
      trainTo: train.at(-1)?.ts ?? 0,
      testFrom: test[0]?.ts ?? 0,
      testTo: test.at(-1)?.ts ?? 0,
      models: modelIds.map((m) => {
        if (m === 'B0' || m === 'B1') {
          const sig = makeIncrementalSignal(m, { volumeMin: 0, setupMin: 0, distanceMin: 0, riskMax: 0 });
          return {
            model: m,
            chosen: null,
            trainMetrics: computeIncrementalMetrics(train, sig, null),
            testMetrics: computeIncrementalMetrics(test, sig, null),
            gridsUsed: grids,
            selectedOnTrainOnly: true as const,
          };
        }
        // 参数组合只在 train 上按 F1 搜索。
        let best: IncrementalParams = { volumeMin: grids.volumeRatio[0], setupMin: grids.setupScore[0], distanceMin: grids.distancePct[0], riskMax: grids.riskMax[0] };
        let bestF1 = -1;
        const vols = m === 'M1' ? grids.volumeRatio : grids.volumeRatio;
        const setups = m === 'M1' ? [grids.setupScore[0]] : grids.setupScore;
        const dists = m === 'M1' ? [grids.distancePct[0]] : grids.distancePct;
        const risks = m === 'M1' || m === 'M2' ? [grids.riskMax[0]] : grids.riskMax;
        for (const volumeMin of vols) {
          for (const setupMin of setups) {
            for (const distanceMin of dists) {
              for (const riskMax of risks) {
                const cand = { volumeMin, setupMin, distanceMin, riskMax };
                const met = computeIncrementalMetrics(train, makeIncrementalSignal(m, cand), null);
                if (met.f1 != null && met.f1 > bestF1) {
                  bestF1 = met.f1;
                  best = cand;
                }
              }
            }
          }
        }
        const sig = makeIncrementalSignal(m, best);
        const scoreFn = m === 'M1' || m === 'M2' ? (r: EpisodeFeatureRow) => incrementalScore(m, r) : null;
        return {
          model: m,
          chosen: best,
          trainMetrics: computeIncrementalMetrics(train, sig, scoreFn),
          testMetrics: computeIncrementalMetrics(test, sig, scoreFn),
          gridsUsed: grids,
          selectedOnTrainOnly: true as const,
        };
      }),
    };
    folds.push(fold);
  }
  return { folds, compliance };
}
