/**
 * V2 十态状态机（纯函数）。
 *
 * 状态必须按实时数据逐步转换，不能通过事后结果直接指定：
 *   MARKET_BLOCKED / NO_SETUP / BUILDING_SETUP / NEAR_BREAKOUT
 *   → BREAKOUT_CONFIRMED → FOLLOW_THROUGH_PENDING
 *   → HEALTHY_BREAKOUT 或 RETESTING 或 FAILED_BREAKOUT
 *   → INVALIDATED（结构彻底破坏）
 */
import type { EnvironmentGate, HardVetoKind, ScoreStatus, StateCode } from './types';

export interface V2StateInput {
  hardVeto: HardVetoKind;
  environmentGate: EnvironmentGate;
  /** 是否已在已收盘 K 线上确认突破（close > rollingHigh）。 */
  breakoutConfirmed: boolean;
  /** 盘中是否出现 high > rollingHigh 但未收盘。 */
  intradayAttempt: boolean;
  /** Follow-through 分数状态（NOT_STARTED / PENDING / COMPUTED / DATA_UNAVAILABLE）。 */
  followThroughStatus: ScoreStatus;
  /** 突破后是否仍站稳突破位上方（close > breakoutLevel）。 */
  heldAboveBreakoutLevel: boolean | null;
  /** 是否正在回踩突破位（价格贴近突破位但未破）。 */
  retesting: boolean;
  /** 突破后是否快速跌回突破位下方（失败突破）。 */
  failedBreakout: boolean;
  /** 是否跌破结构失效位。 */
  invalidated: boolean;
  /** Setup 分（0~100，可能为 null=数据不足）。 */
  setupScore: number | null;
}

/** Setup 预警分层阈值（与 determineStateV2 同源；normal 窗口误报统计复用）。 */
export const NEAR_SETUP_THRESHOLD = 65;
export const BUILDING_SETUP_THRESHOLD = 35;

export function determineStateV2(input: V2StateInput): StateCode {
  // 1) 硬否决
  if (input.hardVeto !== 'NONE') {
    return input.hardVeto === 'STRUCTURE_VETO' ? 'INVALIDATED' : 'MARKET_BLOCKED';
  }
  // 2) 环境闸门
  if (input.environmentGate === 'BLOCK') return 'MARKET_BLOCKED';
  // 3) 结构彻底破坏
  if (input.invalidated) return 'INVALIDATED';

  // 4) 已确认突破
  if (input.breakoutConfirmed) {
    if (input.failedBreakout) return 'FAILED_BREAKOUT';
    if (input.followThroughStatus === 'NOT_STARTED' || input.followThroughStatus === 'PENDING') {
      return 'FOLLOW_THROUGH_PENDING';
    }
    if (input.retesting) return 'RETESTING';
    if (input.heldAboveBreakoutLevel === true) return 'HEALTHY_BREAKOUT';
    return 'FAILED_BREAKOUT';
  }

  // 5) 未突破
  if (input.intradayAttempt) return 'NEAR_BREAKOUT';
  if (input.setupScore == null) return 'NO_SETUP';
  if (input.setupScore >= NEAR_SETUP_THRESHOLD) return 'NEAR_BREAKOUT';
  if (input.setupScore >= BUILDING_SETUP_THRESHOLD) return 'BUILDING_SETUP';
  return 'NO_SETUP';
}
