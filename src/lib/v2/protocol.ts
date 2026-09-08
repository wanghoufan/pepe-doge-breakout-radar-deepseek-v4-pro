/**
 * BACKTEST 预注册协议（代码侧冻结，见 `BACKTEST_PROTOCOL_V1.md`）。
 *
 * 规则：在查看 Test 结果之前冻结 Episode Rule / Feature / 权重 / 标签 / 验证规则 /
 * Test 周期并 commit；查看 Test 后若修改任何参数，原 Test 自动失效，
 * 必须推进到新的 holdout 或重新定义研究阶段。
 *
 * 本模块是协议的机器可读版本：回测脚本默认只使用这里的冻结值；
 * 任何偏离必须显式传入 override 并在报告中标注为「协议外探索」。
 */

export interface FrozenProtocol {
  version: 'BACKTEST_PROTOCOL_V1';
  /** Episode 规则：hybrid（§4 方案 D）。 */
  episodeRule: 'hybrid-D';
  minCooldownBars: number;
  stalenessBars: number;
  detectorLookbackCandles: number;
  /** 主 outcome 标签（AND）。 */
  successLabel: { mfeThreshold: number; maeThreshold: number; windowHours: number };
  /** 候选网格（只能在 train 上搜索，test 只评估一次）。 */
  grids: {
    volumeRatio: number[];
    setupScore: number[];
    distancePct: number[];
    riskMax: number[];
  };
  /** 模型选择规则：在 train 上按 F1 最高选择。 */
  selectionMetric: 'f1';
  /** Test 周期定义：campaign 级 walk-forward，test fold 只能是时间上最后的若干 campaign 组。 */
  testPolicy: string;
  /** 冻结提交（填写协议 commit 后回填；运行时由脚本校验）。 */
  frozenCommit: string | null;
}

export const FROZEN_PROTOCOL: FrozenProtocol = {
  version: 'BACKTEST_PROTOCOL_V1',
  episodeRule: 'hybrid-D',
  minCooldownBars: 6,
  stalenessBars: 12,
  detectorLookbackCandles: 42,
  successLabel: { mfeThreshold: 10, maeThreshold: -8, windowHours: 72 },
  grids: {
    volumeRatio: [1.0, 1.5, 2.0, 3.0],
    setupScore: [40, 50, 60],
    distancePct: [0, 0.5],
    riskMax: [20, 30],
  },
  selectionMetric: 'f1',
  testPolicy: 'campaign-level expanding walk-forward: 同一 campaign 永不跨 train/test；test fold 只能取时间最晚的组',
  frozenCommit: null,
};

/** 校验一次回测运行是否遵守协议（网格必须来自冻结集合的子集）。 */
export function checkProtocolCompliance(used: {
  volumeRatio: number[];
  setupScore: number[];
  distancePct: number[];
  riskMax: number[];
}): { compliant: boolean; violations: string[] } {
  const violations: string[] = [];
  const isSubset = (xs: number[], allowed: number[]) => xs.every((x) => allowed.includes(x));
  if (!isSubset(used.volumeRatio, FROZEN_PROTOCOL.grids.volumeRatio)) violations.push('volumeRatio 网格超出冻结集合');
  if (!isSubset(used.setupScore, FROZEN_PROTOCOL.grids.setupScore)) violations.push('setupScore 网格超出冻结集合');
  if (!isSubset(used.distancePct, FROZEN_PROTOCOL.grids.distancePct)) violations.push('distancePct 网格超出冻结集合');
  if (!isSubset(used.riskMax, FROZEN_PROTOCOL.grids.riskMax)) violations.push('riskMax 网格超出冻结集合');
  return { compliant: violations.length === 0, violations };
}
