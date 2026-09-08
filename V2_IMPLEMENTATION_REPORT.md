# V2_IMPLEMENTATION_REPORT（本轮真实实现说明）

> 基线：`7a22aaa`（上一轮 V2，已取证存在，见 `V2_DELIVERY_FORENSICS.md`）。
> 本轮在其之上做增量整改，不重写 V2。冻结提交：`3d6ea05`（协议+代码，Test 评估之前）。

## 1. 缺陷 → 修复对照（独立审查意见逐项）

| # | 审查缺陷 | 本轮修复（源码） | 状态 |
|---|---|---|---|
| P0-1 | 历史/实时 detector 定义分叉风险 | 已有统一 `detectBreakoutAt`（`7a22aaa`）；本轮再统一 Episode Builder，实时经 `getRealtimeEpisodeMembership` 接入（`engine.ts`），TEST 13 覆盖 | ✅ |
| P0-2 | raw trigger 当独立事件（290 triggers，半数间隔 ≤12H） | `v2/episode.ts`：Raw vs Episode 分离，Hybrid-D reset 规则；116 independent episodes | ✅ |
| §4 | reset 规则拍脑袋 | `scripts/episode-research.ts` 比较 A/B/C/D；冻结 D（`EPISODE_ANALYSIS.md`） | ✅ |
| §5 | clustering 用未来信息 | 顺序 Builder，只用 ≤i 数据；TEST 3 前缀一致性证明 | ✅ |
| §6 | 「217 突破」口径不明 | Raw（290）vs Independent（116）并列；旧 217 保留在旧报告中对照 | ✅ |
| §7–9 | 单阈值单窗口标签 | `v2/outcomes.ts`：多窗口面板 + AND 标签 + 64 格敏感性矩阵（`LABEL_SENSITIVITY.md`） | ✅ |
| §10 | 标签污染实时 | 标签只存于回测行与报告；状态机输入不变（`determineStateV2` 未动） | ✅ |
| §11–13 | normal 仅 5+7 | `v2/normal-windows.ts`：全量 768 窗口 + False Alarm（`NORMAL_WINDOW_ANALYSIS.md`） | ✅ |
| §14–17 | 只有裸突破基线 | `backtest.ts` 增量段：B0/B1/M1–M5 + AUC/频率/中位数（`INCREMENTAL_MODEL_REPORT.md`） | ✅ |
| §18–20 | 无 campaign WF、无冻结 | `campaignWalkForward` + `BACKTEST_PROTOCOL_V1.md`（冻结提交 `3d6ea05` 在评估前） | ✅ |
| §21 D01 | 单数字对比误导 | D01 四窗口全表（`LABEL_SENSITIVITY.md` §4） | ✅ |
| §22 P10 | 无回归 | TEST 4 真实数据：3 triggers → 1 episode（`EP-PEPE-057`） | ✅ |

## 2. 新增/修改文件
- 新增：`src/lib/v2/episode.ts`、`outcomes.ts`、`normal-windows.ts`、`protocol.ts`、
  `remediation.test.ts`（16 项）、`scripts/episode-research.ts`、`scripts/v2-remediation.ts`、
  `V2_DELIVERY_FORENSICS.md`、`BACKTEST_PROTOCOL_V1.md`、`EPISODE_ANALYSIS.md`、
  `LABEL_SENSITIVITY.md`、`NORMAL_WINDOW_ANALYSIS.md`、`WALK_FORWARD_REPORT.md`、
  `INCREMENTAL_MODEL_REPORT.md`、本文件。
- 修改：`src/lib/v2/backtest.ts`（追加增量段，旧函数不动）、`src/lib/v2/engine.ts`
  （`scoreSetupLayer` 导出复用 + episode 归属；评分逻辑逐行搬运，38 旧测试全绿）、
  `src/lib/types.ts`（`BreakoutInfo` 加 4 个可选字段）、`src/lib/state-machine.ts`
  （阈值常量导出）、`package.json` + `AGENTS.md`（test 命令纳入 `v2/`）。
- 未动：`recompute-v2.ts` 及其产出、`event-metrics.json`、任何 UI（episode 字段可选透出，后续可用）。

## 3. 诚实结论（§26）
- 116 independent episodes（PEPE 59 / DOGE 57）；冻结标签成功率 35.3%（≈ 裸突破基线）。
- M1–M4（量/环境/Setup/风险/否决，当前参数化）**样本外不优于裸突破**；ROC-AUC ≈ 0.5。
- 唯一正向候选是 M5 跟随管理（P 提升、信号减半），但样本过小（每 fold 7–12 信号）且弱市失效，
  **不下结论**，待未来 holdout。
- Setup 在干净窗口误报率高（NEAR ~30%/月 ~4 次每币种），当前参数不宜直接做推送强度。

## 4. 生产状态（§27）
- CODE_COMPLETE ✅ / LOCAL_VALIDATED ✅（54/54 + tsc + eslint）
- BACKTEST_VALIDATED ⚠️ 部分：方法论闭环，但样本稀疏，结论多为「无增量/待验证」
- PRODUCTION_DEPLOYED ❌ / PRODUCTION_DATA_VALIDATED ❌（未部署、不宣称）
- 总体：**PARTIAL**——统计口径与评估闭环完成；策略增量价值未证实，不宣称 Production Ready。
