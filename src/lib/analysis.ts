/**
 * 实时雷达引擎入口（V2）。
 *
 * V1 的单一「机会分」已废弃，改为分层信号（见 v2/engine.ts 的 analyzeAssetV2）。
 * 本文件仅作兼容再导出，实时 / 历史 / 回测共用同一套算法，禁止另起实现。
 */
export {
  analyzeAssetV2,
  computeBtcEnvironment,
  computeSetupFeatures,
  computePostBreakoutFeatures,
  evaluateEnvironment,
  evaluateHardVeto,
} from './v2/engine';
export type { AnalyzeContextV2, BtcEnvFields } from './v2/engine';
