# NORMAL_WINDOW_ANALYSIS（全量 Normal Windows + Setup False Alarm Rate）

> 数据源：`scripts/output/v2-remediation-normal.json`
> 定义：固定 48H（12 根 4H）观察窗口，stride 48H，无重叠；窗口内无 episode start
> 即为 Normal（`buildNormalWindows`，TEST 8/9 覆盖）。
> 误报口径：窗口结束时刻用当时已知数据算 Setup 分（与实时引擎同一 `scoreSetupLayer`），
> ≥65 记 NEAR_BREAKOUT 强预警，≥35 记 BUILDING_SETUP 弱预警（与状态机同阈值，TEST 10 覆盖）。

## 1. 全量窗口

| 标的 | 48H 窗口总数 | 可评分（有完整 lookback） | 旧口径（≥30 天间隙） |
|---|---|---|---|
| PEPE | 383 | 379 | 5 |
| DOGE | 385 | 381 | 7 |
| 合计 | **768** | 760 | 12 |

旧口径找的是 ≥30 天长间隙（12 个），与全量 768 个 48H 干净窗口不是一个概念。
Negative baseline 以本表为准（约 725 的审查估算与本轮 768 同量级，差异来自 stride/边界处理）。

## 2. Setup False Alarm Rate

| 标的 | BUILDING_SETUP 出现率 | NEAR_BREAKOUT 出现率 | 月均 BUILDING 误报 | 月均 NEAR 误报 |
|---|---|---|---|---|
| PEPE | 41.95% (159/379) | 28.76% (109/379) | 5.48 次 | 3.76 次 |
| DOGE | 40.68% (155/381) | 33.86% (129/381) | 5.34 次 | 4.45 次 |

## 3. 用户视角结论（「会不会天天喊狼来了」）
- **会。** 在无突破的干净窗口里，Setup 强预警（NEAR）出现率约 30%，弱预警（BUILDING）约 41%；
  折算到单币种每月约 **9–10 次预警**（5.4 弱 + 4.1 强），双币种合计每月约 19 次。
- 这意味着当前 Setup 参数（冻结权重 + 35/65 阈值）**过于敏感**，不能直接当「机会提醒」推送强度。
  后续优化方向（需新协议版本，不得污染本轮 Test）：提高 BUILDING/NEAR 阈值、
  要求环境门 ALLOW、或把 Setup 与 Trigger 绑定（无 trigger 不预警）。
- 本结论基于与实时引擎完全相同的 Setup 函数，是诚实、可复现的上限估计，
  不是调参后报喜。
