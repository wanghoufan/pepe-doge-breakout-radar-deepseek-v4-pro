/**
 * 相似性分析（B 类证据：21 个历史事件的特征向量）。
 *
 * 仅用「启动前」的特征做对比，因为这些特征在事件发生当下即已确定（不会事后改写）：
 * 压缩比、量比、启动前收益、启动前 ATR、启动前资金费率。
 *
 * 相似度 = 1 / (1 + z-score 欧氏距离)，对缺失维度做成对删除（双方都有值才参与）。
 */
import type { EventMetrics } from './event-analysis';
import type { FeatureVector } from './types';

export interface SimilarityFeatureDef {
  key: keyof EventMetrics | 'preAtrPct';
  label: string;
  lowerBetter: boolean;
}

export const SIMILARITY_FEATURES: SimilarityFeatureDef[] = [
  { key: 'compressionRatio', label: 'ATR 收缩比', lowerBetter: true },
  { key: 'preVolumeRatio', label: '量能收缩比', lowerBetter: true },
  { key: 'preReturnPct', label: '启动前收益', lowerBetter: false },
  { key: 'preAtrPct', label: '启动前 ATR', lowerBetter: false },
  { key: 'preFundingAvgPct', label: '启动前费率', lowerBetter: true },
];

export function eventFeatureVector(event: EventMetrics): (number | null)[] {
  return SIMILARITY_FEATURES.map((d) => {
    const v = event[d.key];
    return typeof v === 'number' && Number.isFinite(v) ? (v as number) : null;
  });
}

/** 当前实时状态的同维度特征（用于「当前像谁」）。 */
export function currentFeatureVector(feature: FeatureVector): (number | null)[] {
  return [
    feature.compressionRatio,
    feature.preVolumeRatio,
    feature.preReturnPct,
    null, // 实时无完整启动前 ATR，暂不参与该维度（成对删除）
    feature.fundingAvgPct,
  ];
}

interface Stats {
  mean: number;
  std: number;
}

function zstats(values: number[]): Stats {
  const n = values.length;
  const mean = values.reduce((s, v) => s + v, 0) / n;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  return { mean, std: Math.sqrt(variance) || 1 };
}

export interface SimilarityResult {
  eventId: string;
  score: number; // 0~1，越大越相似
  distance: number;
  sharedDims: number;
  matched: { feature: string; value: number }[];
}

/**
 * 计算 query 与每个历史事件的相似度。
 * 先按每个维度在「全体历史事件」上做 z-score 标准化，再算共享维度欧氏距离。
 */
export function computeSimilarities(
  query: (number | null)[],
  events: EventMetrics[],
): SimilarityResult[] {
  // 每个维度的 z 统计（只用历史事件可用的值）
  const stats = SIMILARITY_FEATURES.map((_, dim) => {
    const vals = events
      .map((e) => eventFeatureVector(e)[dim])
      .filter((v): v is number => v != null);
    return zstats(vals);
  });

  const results = events.map((event) => {
    const ev = eventFeatureVector(event);
    let sumSq = 0;
    let dims = 0;
    const matched: { feature: string; value: number }[] = [];
    for (let d = 0; d < SIMILARITY_FEATURES.length; d++) {
      const q = query[d];
      const e = ev[d];
      if (q == null || e == null) continue;
      const { mean, std } = stats[d];
      const dz = (q - mean) / std;
      const ez = (e - mean) / std;
      sumSq += (dz - ez) ** 2;
      dims++;
      matched.push({ feature: SIMILARITY_FEATURES[d].label, value: e as number });
    }
    const distance = dims ? Math.sqrt(sumSq / dims) : Number.POSITIVE_INFINITY;
    const score = Number.isFinite(distance) ? 1 / (1 + distance) : 0;
    return { eventId: event.id, score, distance, sharedDims: dims, matched };
  });

  return results.sort((a, b) => b.score - a.score);
}

/** 21 个事件两两相似度矩阵（供相似性页锚点选择与热力图）。 */
export function buildSimilarityMatrix(events: EventMetrics[]): {
  id: string;
  neighbors: SimilarityResult[];
}[] {
  return events.map((e) => ({
    id: e.id,
    neighbors: computeSimilarities(eventFeatureVector(e), events).filter((r) => r.eventId !== e.id),
  }));
}

/**
 * 用 PCA（对 z-score 特征矩阵做前两个主成分）把事件投影到 2D，
 * 供相似性页做「近似聚类」散点。仅作可视化，不构成统计结论。
 */
export function scatterProjection(events: EventMetrics[]): { id: string; x: number; y: number }[] {
  const n = events.length;
  const m = SIMILARITY_FEATURES.length;

  // z-score 特征矩阵（缺失值以 0 填充，即列均值）
  const raw = events.map((e) => eventFeatureVector(e));
  const matrix: number[][] = raw.map((row) => {
    return row.map((v, d) => {
      const vals = raw.map((r) => r[d]).filter((x): x is number => x != null);
      const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
      const std = Math.sqrt(vals.reduce((s, x) => s + (x - mean) ** 2, 0) / vals.length) || 1;
      return v == null ? 0 : (v - mean) / std;
    });
  });

  const comps = topComponents(matrix, 2);
  return events.map((e, i) => ({
    id: e.id,
    x: dot(matrix[i], comps[0]),
    y: dot(matrix[i], comps[1]),
  }));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

/** 协方差矩阵的幂迭代 + deflation，取 top-k 特征向量。 */
function topComponents(data: number[][], k: number): number[][] {
  const n = data.length;
  const m = data[0].length;
  let cov = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += data[r][i] * data[r][j];
      cov[i][j] = s / n;
    }
  }
  const comps: number[][] = [];
  for (let c = 0; c < k; c++) {
    let v = new Array<number>(m).fill(0);
    v[c % m] = 1;
    for (let it = 0; it < 200; it++) {
      const y = new Array<number>(m).fill(0);
      for (let i = 0; i < m; i++) {
        let s = 0;
        for (let j = 0; j < m; j++) s += cov[i][j] * v[j];
        y[i] = s;
      }
      const norm = Math.sqrt(y.reduce((s, x) => s + x * x, 0)) || 1;
      v = y.map((x) => x / norm);
    }
    comps.push(v);
    let lambda = 0;
    for (let i = 0; i < m; i++) lambda += v[i] * dot(cov[i].slice(), v);
    const next = cov.map((row, i) => row.map((x, j) => x - lambda * v[i] * v[j]));
    cov = next;
  }
  return comps;
}