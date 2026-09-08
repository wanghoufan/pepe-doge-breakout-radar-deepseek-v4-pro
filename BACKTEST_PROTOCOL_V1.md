# BACKTEST_PROTOCOL_V1（预注册冻结协议）

> 状态：**FROZEN**。本文件在查看任何 Test 结果之前 작성并 commit。
> 查看 Test 结果后若修改以下任何参数，原 Test 自动失效，必须推进到未来新的 holdout
> 或重新定义研究阶段，不得继续称为 out-of-sample。
> 机器可读版本：`src/lib/v2/protocol.ts`（`FROZEN_PROTOCOL`）。

## 1. 冻结内容

### Episode Rule（§2–§5）
- 规则：**Hybrid D**（`FROZEN_EPISODE_RULE`，实现：`src/lib/v2/episode.ts`）。
- 距上一个 trigger 不足 **6 根（24H）**：一律吸收为同 episode。
- 间隔 6–12 根：必须出现结构 reset（收盘跌回 breakout level 下方）才开新 episode。
- 间隔 ≥12 根（48H 无新 trigger）：staleness，直接开新 episode。
- Detector：`detectBreakoutAt`，`lookbackCandles = 42`，`close > rollingHigh`（当前 K 线不参与 rollingHigh），仅已收盘 K 线。
- 选择理由（先验，非 Test 挑选）：24H 最小间隔避免把「连续创新高」切碎；
  48H staleness 与审查独立复算的去重尺度同量级；return-to-range 是结构性 reset，
  非拍脑袋固定 cooldown。候选方案 A/B/C 的比较见 `EPISODE_ANALYSIS.md`（描述性，不做模型选择）。

### Feature List（全部 point-in-time）
- Setup：突破前前缀（严格早于突破 K 线）→ `computeSetupFeatures` + `scoreSetupLayer`（与实时引擎同一函数）。
- Trigger：volumeRatio / distancePct / bodyStrength / fakeWick（突破收盘时已知）。
- Environment：BTC env + gate（trigger 时刻已知）。
- Risk：与实时引擎同口径风险点数（chase40/shortGain15/atrExp15/crowded20/btcRisk10）+ funding（trigger 时刻前 8 个点）。
- Hard Veto：`evaluateHardVeto`（trigger 时刻）。
- Follow-through（仅 M5 管理逻辑）：突破后 24h 站稳 + 量能持续。

### 权重 / 阈值
- Setup/Trigger 权重：`DEFAULT_V2_WEIGHTS`（`src/lib/config.ts`，不做修改）。
- 候选网格（**只能在 train 上搜索**）：volumeRatio ∈ {1.0, 1.5, 2.0, 3.0}；
  setupScore ∈ {40, 50, 60}；distancePct ∈ {0, 0.5}；riskMax ∈ {20, 30}。
- 选择规则：train 上 F1 最高；test 只评估一次。

### Outcome / 标签
- 研究层：每 episode 存 24/48/72H/7D 的 MFE/MAE + timeTo + breakoutReturn（`calculateOutcomeMetrics`）。
- 生产层主标签（AND）：**72H MFE ≥ 10% AND MAE ≥ −8%**（`FROZEN_SUCCESS_LABEL`）。
- 标签仅用于历史监督与评估；实时状态机不消费 outcome。

### Normal Windows
- 固定 48H（12 根 4H），stride 48H，无重叠；窗口内无 episode start 即为 Normal。
- 误报统计：Setup 分层阈值与状态机同源（≥65 NEAR / ≥35 BUILDING）。

### 验证规则 / Test 周期
- Campaign-Level Walk Forward，expanding：同一 campaign 永不跨 train/test；
  fold 边界只落在 campaign/季度组之间；train 时间严格早于 test。
- Test folds 取时间最晚的组；B0（prevalence 行）与 B1（裸突破全信号）为必报基线。
- 报告指标：signals / precision / recall / specificity / FPR / FNR / F1 /
  PR-AUC·ROC-AUC（M1/M2 有自然排序分时）/ median MFE·MAE·return / signals-per-month。
- 低频高精度必须同时报告 recall 与信号频率，禁止只报 precision。

## 2. Test 污染政策（§20）
- 查看 Test 后修改 weight / threshold / feature / 网格 → 原 Test 自动失效。
- 后续优化必须在新 holdout 或新协议版本（`BACKTEST_PROTOCOL_V2.md`）下进行。

## 3. 冻结证据
- 冻结 commit：（本文件提交后回填）。
- 合规自检：`checkProtocolCompliance` 在管线入口执行；walk-forward 结果记录
  `selectedOnTrainOnly: true` 与实际使用网格（`WALK_FORWARD_REPORT.md`）。
