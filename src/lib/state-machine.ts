import type { StateCode } from './types';

/**
 * 六态判定（纯函数）。输入量化的当前价、突破/过热/失效标志，输出稳定状态码。
 *
 * 状态语义见 config.ts 的 STATE_META：
 * forbidden / accumulating / near_breakout / breakout_confirmed / awaiting_pullback / invalidated
 */

export interface StateInput {
  hardVeto: boolean;
  hardVetoKind: 'btc' | 'coin' | null;
  breakoutTriggered: boolean;
  overheated: boolean;
  /** 蓄势维度完成度 0~1 */
  preparationCompletion: number;
  /** 价格距离结构阻力的百分比（正=已越过后回踩更近；负=仍在阻力下方） */
  distanceToBreakoutPct: number | null;
}

export function determineState(input: StateInput): StateCode {
  if (input.hardVeto) {
    return input.hardVetoKind === 'btc' ? 'forbidden' : 'invalidated';
  }
  if (input.breakoutTriggered) {
    return input.overheated ? 'awaiting_pullback' : 'breakout_confirmed';
  }
  // 未触发：根据蓄势完成度决定「临界」还是「蓄势」
  if (input.preparationCompletion >= 0.6) {
    return 'near_breakout';
  }
  return 'accumulating';
}