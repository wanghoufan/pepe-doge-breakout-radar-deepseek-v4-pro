# EPISODE_ANALYSIS（Raw Trigger vs Independent Episode）

> 数据源：`scripts/output/episode-research.json`、`v2-remediation-episodes.json`
> 生成：`node --import tsx scripts/episode-research.ts` / `scripts/v2-remediation.ts`
> 规则：Hybrid-D（`FROZEN_EPISODE_RULE`），detector `lookback=42`，仅已收盘 4H。

## 1. 核心计数（冻结规则 D）

| 标的 | Raw Trigger | Independent Episode | 膨胀比 | T/E mean | median | p90 | max |
|---|---|---|---|---|---|---|---|
| PEPE | 140 | 59 | 2.37x | 2.37 | 2 | 6 | 8 |
| DOGE | 150 | 57 | 2.63x | 2.63 | 2 | 6 | 9 |
| 合计 | **290** | **116** | 2.50x | — | — | — | — |

Raw 数与独立审查复算（140/150）**完全一致**。旧口径「217 突破」（cooldown=1 根，即 4H）
本质是 raw trigger 计数（旧扫描 PEPE 102 / DOGE 115：尾部窗口未走完与边界处理差异所致），
**禁止再直接报告「217 个突破」而不说明口径**。本轮之后：历史样本 = 116 independent episodes。

## 2. Episode 间隔分布（冻结规则 D，相邻 episode start 间隔）

| 标的 | 间隔 median | p90 | max | 间隔 ≤12H 的 episode 对 |
|---|---|---|---|---|
| PEPE | 262H（~11 天） | 724H | 1588H | 0 |
| DOGE | 264H（~11 天） | 804H | 1612H | 0 |

Raw trigger 约半数间隔 ≤12H；经 episode 聚合后，相邻独立事件间隔中位数约 11 天，
无 ≤12H 相邻 episode——重复计数已消除。

## 3. Reset 规则比较（§4 方案 A/B/C/D）

| 规则 | PEPE episodes | DOGE episodes | 合计 | 备注 |
|---|---|---|---|---|
| A-24H（6 根） | 63 | 59 | 122 | 下限：仍偏碎 |
| A-48H（12 根） | 53 | 50 | 103 | 与审查 48H 去重（105）基本一致 |
| A-72H（18 根） | 46 | 46 | 92 | — |
| A-7D（42 根） | 35 | 35 | 70 | 与审查 7D 去重（70）**完全一致**，但 7D 内第二轮真突破会被吞掉 |
| B-return-to-range | 42 | 26 | 68 | DOGE 出现 94-trigger 超级 episode（整段 regime 被吸入），**欠切分** |
| C-atr-base | 39 | 38 | 77 | 偏激进合并 |
| **D-hybrid（冻结）** | **59** | **57** | **116** | 24H 内吸收 / 6–12 根需结构 reset / ≥48H 无 trigger 则新开 |

审查报告中的 48H/7D 只是「证明重复计数存在」的演示，不是最终规则——本轮未直接采用，
而是冻结 Hybrid-D（最小 cooldown + structure reset），理由见 `BACKTEST_PROTOCOL_V1.md`。

## 4. P10 回归（§22）
- 2026-07-03 当天 PEPE 共 3 个 raw trigger，全部归入 **`EP-PEPE-057`**（distinctEpisodes=1）。
- 旧 fixed pre-event resistance 口径下 P10 无突破（`oldNoBreakout`，见旧 `recompute-report.json`），
  rolling detector 下出现突破且多 trigger 正确聚合——P10 已成为自动化测试（TEST 4）。

## 5. D01 口径（§21）
D01 所在 episode 当日 triggers = 1。D01 多窗口 outcome 见 `LABEL_SENSITIVITY.md` §D01；
禁止再写「V1 +224% vs V2 +0.9%」——前者是 21 天人工窗口峰值，后者是突破后 72H MFE。
