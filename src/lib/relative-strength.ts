/**
 * 相对 BTC 强弱（P0-9，V2 核心纯函数）。
 *
 * 不再用「币种事件涨幅 − BTC 事件涨幅」这种各自起算点的差。
 * 改为构造合成比值：
 *     ratio(t) = coinUSDT(t) / btcUSDT(t)
 * 然后基于同一时间窗口计算相对收益与相对强度。
 *
 * 两个资产必须使用完全相同的 K 线时间对齐（按 ts 匹配）。
 */
import { slope, pct } from './indicators';
import { percentileRank } from './statistics';
import type { Candle } from './types';

/** 按 ts 对齐两个资产的收盘价序列，返回 [ts, coinClose, btcClose] 三元组。 */
export function alignCloses(
  coinBars: Pick<Candle, 'ts' | 'c'>[],
  btcBars: Pick<Candle, 'ts' | 'c'>[],
): { ts: number; coin: number; btc: number }[] {
  const btcMap = new Map(btcBars.map((b) => [b.ts, b.c]));
  const out: { ts: number; coin: number; btc: number }[] = [];
  for (const b of coinBars) {
    const bc = btcMap.get(b.ts);
    if (bc != null && bc > 0) out.push({ ts: b.ts, coin: b.c, btc: bc });
  }
  return out;
}

/** 合成比值序列（coin/btc），与 alignCloses 相同顺序。 */
export function syntheticRatio(
  coinBars: Pick<Candle, 'ts' | 'c'>[],
  btcBars: Pick<Candle, 'ts' | 'c'>[],
): { ts: number; ratio: number }[] {
  return alignCloses(coinBars, btcBars).map((r) => ({ ts: r.ts, ratio: r.coin / r.btc }));
}

/**
 * 相对收益：比值在 horizon 根 K 线（4H）内的涨跌幅（%）。
 * 从序列末尾回看 horizon 根，与更早那根做 pct。
 */
export function relativeReturn(
  coinBars: Pick<Candle, 'ts' | 'c'>[],
  btcBars: Pick<Candle, 'ts' | 'c'>[],
  horizonCandles: number,
): number | null {
  const ratio = syntheticRatio(coinBars, btcBars);
  if (ratio.length < 2) return null;
  const end = ratio.at(-1)!.ratio;
  const startIdx = Math.max(0, ratio.length - 1 - horizonCandles);
  const start = ratio[startIdx].ratio;
  if (start <= 0) return null;
  return pct(end, start);
}

/**
 * 相对强度斜率：对最近 n 根 K 线的合成比值做线性回归，返回每根的变化率（比值单位/根）。
 */
export function relativeStrengthSlope(
  coinBars: Pick<Candle, 'ts' | 'c'>[],
  btcBars: Pick<Candle, 'ts' | 'c'>[],
  n: number,
): number | null {
  const ratio = syntheticRatio(coinBars, btcBars).map((r) => r.ratio);
  return slope(ratio, n);
}

/**
 * 相对强度分位：当前合成比值在最近 window 根 K 线（4H）中处于什么分位（0~100）。
 * 高分位 = 相对 BTC 处于强势区。
 */
export function relativeStrengthPercentile(
  coinBars: Pick<Candle, 'ts' | 'c'>[],
  btcBars: Pick<Candle, 'ts' | 'c'>[],
  windowCandles: number,
): number | null {
  const ratio = syntheticRatio(coinBars, btcBars).map((r) => r.ratio);
  if (ratio.length < 2) return null;
  const current = ratio.at(-1)!;
  const hist = ratio.slice(Math.max(0, ratio.length - 1 - windowCandles), -1);
  if (!hist.length) return null;
  return percentileRank(hist, current);
}
