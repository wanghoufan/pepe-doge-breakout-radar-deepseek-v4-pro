/**
 * 历史样本扫描器（V2，Phase 5）。
 *
 * 用与实时系统**完全相同**的 rolling breakout detector，在全量 4H 历史数据上
 * 自动找出所有突破事件，再根据「未来 N 天表现」做**事后标签**。
 *
 * 关键约束：未来数据只用于 LABEL（outcome），绝不用于当刻的 FEATURE。
 */
import { detectAllBreakouts } from '../breakout';
import { calculateExcursionPanel } from '../mfe-mae';
import type { Candle } from '../types';

export type BreakoutOutcome = 'success' | 'failure';

export interface BreakoutSample {
  coin: 'PEPE' | 'DOGE';
  ts: number;
  level: number;
  close: number;
  distancePct: number;
  volumeRatio: number | null;
  mfe24h: number | null;
  mae24h: number | null;
  mfe48h: number | null;
  mae48h: number | null;
  mfe72h: number | null;
  mae72h: number | null;
  mfe7d: number | null;
  mae7d: number | null;
  outcome: BreakoutOutcome | null;
  campaignId: string | null;
}

/** 扫描某币种全量历史的所有突破事件（含 MFE/MAE 面板与 campaign 归属）。 */
export function scanBreakoutSamples(coin: 'PEPE' | 'DOGE', coinBars: Candle[]): BreakoutSample[] {
  const signals = detectAllBreakouts(coinBars, { lookbackCandles: 42, cooldownCandles: 1 });
  return signals.map((s) => {
    const panel = calculateExcursionPanel(coinBars, s.ts, s.close);
    return {
      coin,
      ts: s.ts,
      level: s.level,
      close: s.close,
      distancePct: s.distancePct,
      volumeRatio: s.volumeRatio,
      mfe24h: panel.horizons['24h'].mfe,
      mae24h: panel.horizons['24h'].mae,
      mfe48h: panel.horizons['48h'].mfe,
      mae48h: panel.horizons['48h'].mae,
      mfe72h: panel.horizons['72h'].mfe,
      mae72h: panel.horizons['72h'].mae,
      mfe7d: panel.horizons['168h'].mfe,
      mae7d: panel.horizons['168h'].mae,
      outcome: null,
      campaignId: null,
    };
  });
}

export interface OutcomeThresholds {
  /** 成功：72h MFE ≥ 该百分比。 */
  successMfe72hPct: number;
  /** 成功：72h MAE ≥ 该值（负值，即回撤不超过 |该值|）。 */
  successMae72hPct: number;
}

/**
 * 给突破样本打「事后标签」（二元）。
 * 成功：72h MFE ≥ successMfe72hPct 且 MAE ≥ successMae72hPct（回撤可控）。
 * 失败：其余所有突破（未达到成功门槛，含快速跌回突破位下方者）。
 * 未来数据只用于 LABEL，绝不用于当刻 FEATURE。
 */
export function labelBreakoutOutcomes(samples: BreakoutSample[], t: OutcomeThresholds): BreakoutSample[] {
  for (const s of samples) {
    if (s.mfe72h == null || s.mae72h == null) {
      s.outcome = null; // 数据不足（突破临近样本末尾，72h 未走完），无法标签
      continue;
    }
    s.outcome = s.mfe72h >= t.successMfe72hPct && s.mae72h >= t.successMae72hPct ? 'success' : 'failure';
  }
  return samples;
}

/** 统计普通窗口（长期无突破）：返回连续无突破的最长若干段（天数）。 */
export function findNormalWindows(
  coinBars: Candle[],
  minGapDays: number,
): { startTs: number; endTs: number; days: number }[] {
  const signals = detectAllBreakouts(coinBars, { lookbackCandles: 42, cooldownCandles: 1 });
  const breakoutTs = new Set(signals.map((s) => s.ts));
  const windows: { startTs: number; endTs: number; days: number }[] = [];
  const gapMs = minGapDays * 86_400_000;

  let segStart: number | null = null;
  let lastTs: number | null = null;
  for (const b of coinBars) {
    const isB = breakoutTs.has(b.ts);
    if (!isB) {
      if (segStart == null) segStart = b.ts;
      lastTs = b.ts;
    } else {
      if (segStart != null && lastTs != null && lastTs - segStart >= gapMs) {
        windows.push({ startTs: segStart, endTs: lastTs, days: (lastTs - segStart) / 86_400_000 });
      }
      segStart = null;
      lastTs = null;
    }
  }
  if (segStart != null && lastTs != null && lastTs - segStart >= gapMs) {
    windows.push({ startTs: segStart, endTs: lastTs, days: (lastTs - segStart) / 86_400_000 });
  }
  return windows;
}
