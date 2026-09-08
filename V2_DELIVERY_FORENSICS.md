# V2 交付取证报告（Delivery Forensics）

> 生成时间：2026-09-08（UTC+8）。本文件回答「上一轮 V2 到底在哪里」，是本轮整改的前置取证。
> 取证命令与源码搜索均已实际执行，结论基于 `git` 真实状态，不采信任何二手转述。

## Repository

真实仓库路径：`/Users/zzymima0000/Developer/Playground/pepe-doge-breakout-radar-deepseek-v4-pro/sprat`

远端：`https://github.com/wanghoufan/pepe-doge-breakout-radar-deepseek-v4-pro.git`

## Target Branch

目标分支：`wanghoufan/sprat`（当前 worktree 所在分支）

## Starting HEAD

整改前 HEAD：`7a22aaadee9722928e020246e5bebd503855cafd`
（`feat(radar): V1→V2 突破识别系统整改`，2026-09-08 08:09 +0800）

## Working Tree

`git status --porcelain` 结果：仅 1 个未跟踪文件 `V2-audit-report-2026-09-08.md`
（审查报告的投递件，未 commit）。除此之外 **clean，无 dirty 修改、无 stash**（`git stash list` 为空）。

## Existing V2 Code

**FOUND** —— 上一轮 V2 代码真实存在，且已 push。

## V2 Location

| 项目 | 取证结果 |
|---|---|
| Branch | `wanghoufan/sprat`（HEAD 即 V2 提交）以及 `main`（V2 提交是其祖先） |
| Worktree | 本 worktree（`.../Playground/pepe-doge-breakout-radar-deepseek-v4-pro/sprat`）；另有一 worktree 在 `main`（`f586d4a`，含 V2） |
| Commit | `7a22aaa`（父提交 `052b743`），`git merge-base --is-ancestor 7a22aaa origin/main` = true，**已同步到远端，无未 push commit**（`git log origin/main..wanghoufan/sprat` 为空） |

为什么审查报告写的是「HEAD `052b743` 中不存在 V2」：
`052b743` 恰好是 `7a22aaa` 的**父提交**。审查结论在其审查时刻的快照上成立
（`052b743` 树中确实无 `src/lib/breakout.ts` / `src/lib/v2/` / `src/lib/mfe-mae.ts`），
但把它推广为「仓库中不存在任何 V2 代码 / `git log --all` 仅 5 个 V1 提交」是**以偏概全**：
`git log --all` 实际显示 7 个提交（含 `7a22aaa` 与 `f586d4a`），
且 `f586d4a`（`origin/main`）的父提交就是 `7a22aaa`。

## Previous Report Verification

逐项验证上一轮完成报告（`scripts/output/Breakout-Radar-V2-整改报告.md`），
**只认源码 + 可执行测试为证据，不认报告自证**。
（注：验证时 `node_modules` 缺失导致 `pnpm test` 报 `Cannot find package 'tsx'`；
执行 `pnpm install` 后恢复，属环境问题，非代码问题。）

| 上一轮声称 | 源码证据（commit `7a22aaa` 内） | 结论 |
|---|---|---|
| 38 tests 通过 | `src/lib/v2.test.ts`（10 项）+ `indicators/event-analysis/state-machine` 测试；`pnpm test` 实测 **38 pass / 0 fail** | ✅ VERIFIED |
| 统一 detector（历史/实时/回测共用） | `src/lib/breakout.ts`：`getRollingHigh` / `detectBreakoutAt` / `detectBreakout` / `detectAllBreakouts`；`engine.ts:14,288`、`event-analysis.ts:11,129,138`、`v2/samples.ts:36` 共用 | ✅ VERIFIED（规则本身本轮仍要整改见下） |
| Setup / Trigger / Risk / Environment 分层 | `src/lib/v2/engine.ts`（812 行）：`computeSetupFeatures` / `computePostBreakoutFeatures` / `evaluateEnvironment` / `evaluateHardVeto` + 六层评分 | ✅ VERIFIED（存在；回测增量价值未证见下） |
| MFE / MAE | `src/lib/mfe-mae.ts`：`calculateExcursion` / `calculateMFE` / `calculateMAE` / `calculateExcursionPanel`（24/48/72/7D） | ✅ VERIFIED |
| 217 breakouts | `detectAllBreakouts(cooldown=1)` 扫描输出，经 `scripts/recompute-v2.ts` 写入 `recompute-report.json`（`distribution.count=217`，PEPE 102 / DOGE 115） | ⚠️ **数字可复现，但定义有缺陷**：`cooldownCandles=1`（4H）≈ 把 raw trigger 当独立事件（本轮 P0-2 整改对象） |
| 75 success / 142 failure | `v2/samples.ts:labelBreakoutOutcomes`（72h MFE≥10% AND MAE≥−8%） | ⚠️ **逻辑存在（AND），但单阈值单窗口**，未经敏感性分析（本轮 §7–9 整改对象） |
| walk-forward | `v2/backtest.ts:walkForwardBacktest`（5 folds，train 早于 test，TEST 7 覆盖） | ⚠️ **存在但不合格**：按样本计数切分（非 campaign 级），信号规则只有 volume+distance（无 Setup/Trigger/Risk/Environment 增量比较），指标缺 specificity/FNR/频率（本轮 §14–18 整改对象） |
| Normal Windows（PEPE 5 / DOGE 7） | `v2/samples.ts:findNormalWindows(minGapDays=30)` | ❌ **方法错误**：找的是 ≥30 天长间隙（`recompute-report.json: normalWindows`），不是全量 48H 干净窗口（应约 700+）；False Alarm Rate 未计算（本轮 §11–13 整改对象） |
| Episode clustering / cooldown 研究 | 仅 `cooldownCandles=1` 的 trivial 去重，无 episode 状态机、无 reset 规则研究 | ❌ NO SOURCE EVIDENCE（本轮 §2–6 新建） |
| Label sensitivity | 无源码（整改报告自身第 177 行承认「未扫描阈值空间」） | ❌ NO SOURCE EVIDENCE（本轮 §9 新建） |
| Incremental backtest（M1–M5 vs Baseline） | 无源码 | ❌ NO SOURCE EVIDENCE（本轮 §14–17 新建） |
| Campaign-level WF / Protocol freeze | 无源码 | ❌ NO SOURCE EVIDENCE（本轮 §18–20 新建） |

## 取证结论

1. **上一轮 V2 代码真实存在**（`7a22aaa`，已 push，是 `origin/main` 祖先），
   不存在「丢失 / 未提交 / 藏在别的 worktree 或 stash」的致力情况。
   审查报告的「不存在」结论仅对其审查快照（`052b743` = V2 提交的父提交）成立。
2. **但上一轮 V2 在方法论上确实存在审查指出的硬伤**（上表 ⚠️/❌ 行）：
   raw trigger ≈ 独立事件（217 计数口径）、单阈值单窗口标签、
   非全量 normal 窗口、无增量回测、无 campaign 级 walk-forward、无敏感性分析。
   这些不是「代码丢失」，是「代码存在但统计口径不合格」——正是本轮要整改的真实对象。
3. 因此本轮策略：**不重写 V2，而是在 `7a22aaa` 基线上做增量整改**
   （新增 episode/outcome/normal-window/增量回测模块 + 冻结协议 + 完整报告矩阵），
   所有历史结论保留口径对照（Raw vs Independent 并列），不篡改已有 `recompute-report.json`。
