/**
 * 统计辅助（V2）：percentile / rank 等，用于把「绝对阈值」升级为「分位阈值」。
 *
 * 所有函数为纯函数，输入相同则输出相同。
 */

/** 数值数组的线性插值分位数（percentile ∈ [0,100]）。 */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const xs = [...values].sort((a, b) => a - b);
  if (xs.length === 1) return xs[0];
  const rank = (p / 100) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return xs[lo];
  const w = rank - lo;
  return xs[lo] * (1 - w) + xs[hi] * w;
}

/**
 * 目标值在给定样本中的百分位秩（0~100）。
 * 返回「样本中小于等于 target 的比例 × 100」。
 * 用于：当前 ATR / 成交量 相对过去 60D/90D 处于什么分位。
 */
export function percentileRank(values: number[], target: number): number | null {
  if (!values.length) return null;
  let le = 0;
  for (const v of values) if (v <= target) le++;
  return (le / values.length) * 100;
}

/** 中位数（等价 percentile 50）。 */
export function median(values: number[]): number | null {
  return percentile(values, 50);
}
