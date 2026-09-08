/**
 * Outcome Metrics（研究层）与 Success/Failure 标签（生产层）分离（V2 整改 §7–§10）。
 *
 * - 研究层：每个 episode 永久保存多窗口 MFE/MAE + timeTo + breakoutReturn，
 *   不急于压成二元标签。
 * - 生产层：`classifyHistoricalOutcome` 用 AND 逻辑打标签，
 *   仅用于历史监督与评估；实时状态机绝不消费 outcome label（严格 point-in-time）。
 */

import { calculateExcursion } from '../mfe-mae';
import { HOUR_MS } from '../time';
import type { Candle } from '../types';
import type { BreakoutEpisode } from './episode';

/** 标准 outcome 窗口（小时）：24H / 48H / 72H / 7D。 */
export const OUTCOME_WINDOWS = [24, 48, 72, 168] as const;
export type OutcomeWindow = (typeof OUTCOME_WINDOWS)[number];

/** 敏感性网格（冻结，见 BACKTEST_PROTOCOL_V1.md）。 */
export const MFE_GRID = [5, 10, 15, 20] as const;
export const MAE_GRID = [-5, -8, -10, -15] as const;

export interface WindowOutcome {
  windowHours: number;
  mfe: number | null;
  mae: number | null;
  /** 达到 MFE 极值的时间（突破后小时数，窗口内首个达到极值的 K 线）。 */
  timeToMfeHours: number | null;
  /** 达到 MAE 极值的时间（突破后小时数）。 */
  timeToMaeHours: number | null;
  /** 窗口末收盘价相对 breakoutClose 的收益（%）。 */
  breakoutReturn: number | null;
  /** 窗口内已收盘 K 线根数。 */
  bars: number;
}

export interface OutcomeMetrics {
  episodeId: string;
  breakoutTs: number;
  refPrice: number;
  windows: Record<string, WindowOutcome>;
}

function windowKey(h: number): string {
  return `${h}h`;
}

/**
 * 计算一个 episode 的完整 outcome 面板（事后标签，允许使用未来数据，
 * 但结果绝不回流到任何当刻 feature）。
 */
export function calculateOutcomeMetrics(
  candles: Candle[],
  episode: Pick<BreakoutEpisode, 'id' | 'startTs'>,
  refPrice: number,
): OutcomeMetrics {
  const sorted = candles.slice().sort((a, b) => a.ts - b.ts);
  const windows: Record<string, WindowOutcome> = {};
  for (const h of OUTCOME_WINDOWS) {
    const horizonMs = h * HOUR_MS;
    const end = episode.startTs + horizonMs;
    let high: number | null = null;
    let low: number | null = null;
    let timeToMfeHours: number | null = null;
    let timeToMaeHours: number | null = null;
    let lastClose: number | null = null;
    let bars = 0;
    for (const b of sorted) {
      if (b.ts <= episode.startTs) continue;
      if (b.ts > end) break;
      bars++;
      if (high == null || b.h > high) {
        high = b.h;
        timeToMfeHours = (b.ts - episode.startTs) / HOUR_MS;
      }
      if (low == null || b.l < low) {
        low = b.l;
        timeToMaeHours = (b.ts - episode.startTs) / HOUR_MS;
      }
      lastClose = b.c;
    }
    const ex = calculateExcursion(sorted, episode.startTs, h, refPrice);
    windows[windowKey(h)] = {
      windowHours: h,
      mfe: ex.mfe,
      mae: ex.mae,
      timeToMfeHours: ex.mfe == null ? null : timeToMfeHours,
      timeToMaeHours: ex.mae == null ? null : timeToMaeHours,
      breakoutReturn: lastClose == null ? null : (lastClose / refPrice - 1) * 100,
      bars,
    };
  }
  return { episodeId: episode.id, breakoutTs: episode.startTs, refPrice, windows };
}

export interface SuccessLabel {
  /** MFE ≥ 该值（%）。 */
  mfeThreshold: number;
  /** MAE ≥ 该值（负值，即回撤不超过 |该值|）。 */
  maeThreshold: number;
  /** 评估窗口（小时）。 */
  windowHours: number;
}

/** 冻结主标签（见 BACKTEST_PROTOCOL_V1.md）：72H MFE ≥ 10% AND MAE ≥ −8%。 */
export const FROZEN_SUCCESS_LABEL: SuccessLabel = { mfeThreshold: 10, maeThreshold: -8, windowHours: 72 };

/**
 * 历史 outcome 二元标签。必须使用 AND：
 *   SUCCESS = MFE ≥ threshold AND MAE ≥ allowedDrawdown
 * 禁止 OR（OR 会把「大涨后大跌」也算成功）。
 */
export function classifyHistoricalOutcome(
  metrics: OutcomeMetrics,
  label: SuccessLabel = FROZEN_SUCCESS_LABEL,
): 'success' | 'failure' | null {
  const w = metrics.windows[windowKey(label.windowHours)];
  if (!w || w.mfe == null || w.mae == null) return null; // 窗口未走完：无法标签
  return w.mfe >= label.mfeThreshold && w.mae >= label.maeThreshold ? 'success' : 'failure';
}

export interface SensitivityCell {
  mfeThreshold: number;
  maeThreshold: number;
  windowHours: number;
  total: number;
  labeled: number;
  success: number;
  failure: number;
  successRate: number | null;
}

/**
 * 敏感性矩阵：MFE{5,10,15,20} × MAE{−5,−8,−10,−15} × {24,48,72,168}。
 * 证明 success rate 对阈值的敏感性，不把单组阈值当真理。
 */
export function buildSensitivityMatrix(metricsList: OutcomeMetrics[]): SensitivityCell[] {
  const cells: SensitivityCell[] = [];
  for (const windowHours of OUTCOME_WINDOWS) {
    for (const mfeThreshold of MFE_GRID) {
      for (const maeThreshold of MAE_GRID) {
        let success = 0;
        let failure = 0;
        for (const m of metricsList) {
          const out = classifyHistoricalOutcome(m, { mfeThreshold, maeThreshold, windowHours });
          if (out === 'success') success++;
          else if (out === 'failure') failure++;
        }
        const labeled = success + failure;
        cells.push({
          mfeThreshold,
          maeThreshold,
          windowHours,
          total: metricsList.length,
          labeled,
          success,
          failure,
          successRate: labeled > 0 ? success / labeled : null,
        });
      }
    }
  }
  return cells;
}
