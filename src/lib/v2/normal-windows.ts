/**
 * Normal / Negative Windows 全量生成（V2 整改 §11–§13）。
 *
 * 取代旧 `findNormalWindows(minGapDays=30)`（只找 ≥30 天长间隙，全历史仅 5+7 个，
 * 不能作为 negative baseline）。
 *
 * 新定义：
 * - 固定观察窗口：默认 48H（12 根 4H），stride = 48H，无重叠（保证统计独立性）。
 * - 资格：窗口 (startTs, endTs] 内**没有 Independent Breakout Episode 的 start**，
 *   则为 Normal / Negative Window。判定只用 episode start（当刻已知），无未来信息。
 * - overlap policy：窗口之间不重叠；episode outcome 评估窗（突破后 7D）与 normal
 *   窗口可能重叠——如实标注（outcome 属事后标签，不污染当刻 feature）。
 */

import type { Candle } from '../types';
import type { BreakoutEpisode } from './episode';
import { BUILDING_SETUP_THRESHOLD, NEAR_SETUP_THRESHOLD } from '../state-machine';

export interface NormalWindow {
  id: string;
  coin: 'PEPE' | 'DOGE' | 'UNKNOWN';
  startIndex: number;
  endIndex: number;
  startTs: number;
  endTs: number;
  /** 窗口结束时其前 `lookbackCandles` 历史是否足够（Setup 可算）。 */
  hasFullLookback: boolean;
}

export interface NormalWindowConfig {
  /** 观察窗口长度（根数，默认 12 = 48H）。 */
  windowBars: number;
  /** 步长（根数，默认 12 = 无重叠）。 */
  strideBars: number;
}

export const DEFAULT_NORMAL_WINDOW_CONFIG: NormalWindowConfig = {
  windowBars: 12,
  strideBars: 12,
};

/**
 * 全量生成 normal windows。episodeStarts：episode start 的 ts 集合
 *（由 `buildBreakoutEpisodes` 产出，同一 Builder，保证口径一致）。
 */
export function buildNormalWindows(
  candles: Candle[],
  episodeStarts: Set<number>,
  config: NormalWindowConfig = DEFAULT_NORMAL_WINDOW_CONFIG,
  coin: NormalWindow['coin'] = 'UNKNOWN',
  lookbackCandles = 42,
): NormalWindow[] {
  const sorted = candles.slice().sort((a, b) => a.ts - b.ts);
  const out: NormalWindow[] = [];
  let seq = 1;
  for (let start = 0; start + config.windowBars <= sorted.length; start += config.strideBars) {
    const end = start + config.windowBars - 1;
    const startTs = sorted[start].ts;
    const endTs = sorted[end].ts;
    let hasEpisodeStart = false;
    for (let i = start; i <= end; i++) {
      if (episodeStarts.has(sorted[i].ts)) {
        hasEpisodeStart = true;
        break;
      }
    }
    if (hasEpisodeStart) continue;
    out.push({
      id: `NW-${coin}-${String(seq++).padStart(3, '0')}`,
      coin,
      startIndex: start,
      endIndex: end,
      startTs,
      endTs,
      hasFullLookback: start >= lookbackCandles,
    });
  }
  return out;
}

/**
 * Setup 预警分层（与状态机同阈值，供 Normal Window False Alarm 统计用）：
 * - setupScore == null → 'NO_SETUP'（数据不足≠预警）
 * - ≥65 → 'NEAR_BREAKOUT'（强预警）
 * - ≥35 → 'BUILDING_SETUP'（弱预警）
 * - 否则 → 'NO_SETUP'
 */
export type SetupAlertLevel = 'NO_SETUP' | 'BUILDING_SETUP' | 'NEAR_BREAKOUT';

export function setupAlertLevel(setupScore: number | null): SetupAlertLevel {
  if (setupScore == null) return 'NO_SETUP';
  if (setupScore >= NEAR_SETUP_THRESHOLD) return 'NEAR_BREAKOUT';
  if (setupScore >= BUILDING_SETUP_THRESHOLD) return 'BUILDING_SETUP';
  return 'NO_SETUP';
}
