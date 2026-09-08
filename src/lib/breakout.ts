/**
 * Rolling Breakout 检测器（P0-2，V2 核心纯函数）。
 *
 * 实时系统、历史分析、回测三处共用同一套 detector，禁止各自实现一份。
 *
 * 定义（point-in-time）：
 * - 对于每一根**已收盘**的 4H K 线 t：
 *     rollingHigh(t) = MAX( high[t-N ... t-1] )   // 此前 N 根，当前 K 线不参与
 * - 若 close[t] > rollingHigh(t)，判定为「4H 收盘突破」。
 * - 默认 N = 42（7 天 × 6 根 4H K 线）。
 *
 * 输出结构保存：breakoutLevel / breakoutTs / breakoutClose /
 *              breakoutDistancePct / breakoutVolumeRatio。
 */
import { median } from './indicators';
import type { Candle } from './types';

export interface BreakoutConfig {
  /** rollingHigh 回看 K 线根数（默认 42 = 7 天 × 6 根 4H）。 */
  lookbackCandles: number;
  /** 突破量比基线回看根数（用于 breakoutVolumeRatio 的 median 分母）。默认同 lookback。 */
  volumeBaselineCandles?: number;
  /**
   * 两次独立突破事件之间的最小间隔（根数）。用于把连续多根「close 持续高于
   * rollingHigh」的 K 线合并成同一次突破（取第一根）。默认 1。
   */
  cooldownCandles?: number;
}

export const DEFAULT_BREAKOUT_CONFIG: BreakoutConfig = {
  lookbackCandles: 42,
  volumeBaselineCandles: 42,
  cooldownCandles: 1,
};

export interface BreakoutSignal {
  /** 突破 K 线的 open ts（breakoutTs）。 */
  ts: number;
  /** 突破位（rollingHigh，等于此前 N 根最高价）。 */
  level: number;
  /** 突破 K 线收盘价。 */
  close: number;
  /** (close / level - 1) * 100，突破当根超越幅度（百分比）。 */
  distancePct: number;
  /** 突破 K 线 quoteVol / 此前 N 根 quoteVol 中位数。 */
  volumeRatio: number | null;
  /** 该突破在输入数组中的下标。 */
  index: number;
}

/**
 * 此前 N 根 K 线的最高价（不包含当前下标 i 这根）。
 * 若不足 N 根历史，则用全部已有历史（仍不含 i）；一根都没有则返回 null。
 */
export function getRollingHigh(
  candles: Pick<Candle, 'h'>[],
  index: number,
  lookback: number,
): number | null {
  const from = Math.max(0, index - lookback);
  if (index <= 0) return null;
  let high = -Infinity;
  for (let i = from; i < index; i++) {
    if (candles[i].h > high) high = candles[i].h;
  }
  return high === -Infinity ? null : high;
}

/**
 * 单根判定：下标 index 这根是否构成 4H 收盘突破。
 * 前提：candles 已按 ts 升序、且只含已收盘 K 线（调用方保证，实时链路已用 confirmed 过滤）。
 */
export function detectBreakoutAt(
  candles: Candle[],
  index: number,
  config: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG,
): BreakoutSignal | null {
  if (index < 0 || index >= candles.length) return null;
  const level = getRollingHigh(candles, index, config.lookbackCandles);
  if (level == null) return null;
  const bar = candles[index];
  if (!(bar.c > level)) return null;

  const volBase = config.volumeBaselineCandles ?? config.lookbackCandles;
  const from = Math.max(0, index - volBase);
  const priorVols: number[] = [];
  for (let i = from; i < index; i++) priorVols.push(candles[i].quoteVol);
  const med = median(priorVols);
  const volumeRatio = med != null && med > 0 ? bar.quoteVol / med : null;

  return {
    ts: bar.ts,
    level,
    close: bar.c,
    distancePct: (bar.c / level - 1) * 100,
    volumeRatio,
    index,
  };
}

/**
 * 首个满足 close > rollingHigh 的突破信号（在给定已收盘序列中从前往后找）。
 * 用于实时链路：给出「最近一次有效突破」。
 */
export function detectBreakout(
  candles: Candle[],
  config: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG,
): BreakoutSignal | null {
  for (let i = candles.length - 1; i >= 0; i--) {
    const sig = detectBreakoutAt(candles, i, config);
    if (sig) return sig;
  }
  return null;
}

/**
 * 扫描全部突破事件（用于历史样本/回测）。
 * 连续「close 持续高于 rollingHigh」的多根 K 线合并为同一次事件（取第一根），
 * 事件之间至少间隔 cooldownCandles 根才视作新事件。
 */
export function detectAllBreakouts(
  candles: Candle[],
  config: BreakoutConfig = DEFAULT_BREAKOUT_CONFIG,
): BreakoutSignal[] {
  const out: BreakoutSignal[] = [];
  const cooldown = config.cooldownCandles ?? 1;
  let lastIdx = -Infinity;
  for (let i = 0; i < candles.length; i++) {
    const sig = detectBreakoutAt(candles, i, config);
    if (!sig) continue;
    if (i - lastIdx <= cooldown) continue; // 与上一次突破合并
    out.push(sig);
    lastIdx = i;
  }
  return out;
}
