/**
 * Walk-forward 回测（V2，Phase 6）。
 *
 * 严格时间序列回测：Train 用较早历史、Validation 用中间、Test 用最新历史，
 * 滚动推进。禁止「拿全部历史挑完规则再拿全部历史证明规则有效」。
 *
 * 拆分口径：按时间（campaign 级）拆分，同一轮行情（PEPE+DOGE）天然落在同一段，
 * 不会出现 PEPE 在训练集、DOGE 在测试集的市场环境泄漏。
 */
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
