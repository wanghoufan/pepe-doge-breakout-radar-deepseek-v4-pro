# Breakout Radar V2 独立量化审查报告

> 审查时间：2026-09-08（UTC）｜ 审查对象：`pepe-doge-breakout-radar-deepseek-v4-pro/sprat`（分支 `wanghoufan/sprat`，HEAD `052b743`）
> 审查方法：源码定位 + 独立复算（快照 4H K 线 5298 根/币种）+ 测试与生产实测。所有数字均可复现，复算脚本保留在 `/tmp/opencode/audit/`（`scan.py / labels.py / normal_d01p10.py / p10.py / baseline.py`）。
> 角色：独立量化审查者，不做开发，不采信整改报告，只认源码、测试、回测输出、历史数据与实际运行结果。

**结论：FAIL（不通过）**

核心事实先行：**仓库中不存在任何 V2 代码**——无自动扫描器、无 Setup/Trigger/Risk/Environment 多层策略、无 Success/Failure 标签逻辑、无 Normal 窗口生成器、无 walk-forward、无 cooldown/clustering（`git log --all` 仅 5 个 V1 提交；全库 `rg` 无 `Setup Score|Trigger Score|walk-forward|cooldown` 命中）。因此所有 V2 声明都只能判"无证据"，而独立复算进一步证伪了其中关键定量声明。

---

## 一、P0 修复逐项验证（源码定位）

| # | 声明 | 证据 | 判定 |
|---|---|---|---|
| 1 | 内部时间统一 UTC timestamp | `src/lib/event-analysis.ts:85-86` `Date.parse(...T00:00:00Z)`；`src/lib/types.ts:5` 约定 UTC epoch ms | ✅（V1 范围） |
| 2 | UTC+8→UTC 转换正确 | 存储侧全 UTC；展示侧 `src/lib/format.ts:3-17` `timeZone:'Asia/Shanghai'`，Intl 转换正确 | ✅ |
| 3 | rollingHigh(t) 只用 t-42…t-1 | **V1 实时** `src/lib/analysis.ts:109` `ts < nowTs` ✅；但 **V1 历史** `src/lib/event-analysis.ts:102-109` 用的根本不是 rolling，而是固定"启动前 7 日最高 + 窗口内首个收盘突破"，V2 所谓 rolling detector 在库中**不存在** | ⚠️ V1 通过 / V2 无对象可验 |
| 4 | 当前 Candle 不进入 resistance | `src/lib/analysis.ts:109` 明确排除 | ✅（实时路径） |
| 5 | 只有已关闭 4H candle 确认突破 | `src/lib/market-service.ts:158-167` confirmed/intraday 分流 ✅；但 `analysis.ts` 本身信任调用方传入，若直连快照/裸调用则无强制 | ⚠️ 依赖调用方，有条件通过 |
| 6-7 | breakoutTs 来自统一 detector；三端共用 | V1 历史 detector（固定窗口首破）与实时 detector（rolling 7D）是**两套不同定义**（见 P10：同一窗口一有一无）。V2 统一 detector 无代码 | ❌ 不成立 |
| 8-9 | Follow-through/MFE/MAE 起算点 | V1 无此计算；V2 无代码 | ❌ 无法验证 |
| 10-11 | Setup 无未来数据；similarity 无未来特征 | `src/lib/similarity.ts:18-24` 仅 pre-start 五维（compression/preVolume/preReturn/preAtr/preFunding），`currentFeatureVector` 对 ATR 成对删除 | ✅（V1 范围） |

---

## 二/三、重复事件与独立性（最高优先级，P0）

用正确检测器（rolling 42 根、仅收盘价、`c[t] > max(h[t-42..t-1])`）独立全历史扫描：

| | PEPE | DOGE |
|---|---|---|
| 原始 trigger（raw） | **140** | **150**（合计 290 ≠ 声称 217） |
| 相邻间隔 ≤12H（4H/8H/12H） | 44/11/10 = **47%** | 48/17/11 = **51%** |
| 48H cooldown 去重后独立 episode | **54**（膨胀 2.6×） | **51**（膨胀 2.9×） |
| 7D cooldown 去重后 | **35**（膨胀 4.0×） | **35**（膨胀 4.3×） |
| 最大 cluster 规模 | 8 根（48H）/ 12 根（7D） | 9 根（48H）/ 14 根（7D） |
| 样本集中月份 | 2024-09 占 12 根 | 2025-09 占 14 根 |

- **P10 窗口就是活证据**：rolling 检测在 2026-07-03 的 12 小时内打出 **3 个 trigger**（08:00/16:00/20:00，最高 +5.93%），属同一轮上涨。若不做 clustering，一轮行情即被计为 3 个"独立样本"。**去重机制缺失 = P0 统计缺陷，成立。**
- 217 既不等于独立复算的 raw（290），也不等于去重后（105/70），且扫描器无源码 → **217 的构成不可审计**。

---

## 四、Success/Failure 标签审计（P0）

- 标签逻辑（AND/OR）、时间窗口在库中**均无定义**，75/142 不可复现。
- 独立敏感性矩阵（独立 episode，48H cooldown，AND 逻辑）：

| 窗口 | MFE≥5% | MFE≥10% | MFE≥15% | MFE≥20%（MAE≥-8%，PEPE/DOGE） |
|---|---|---|---|---|
| 24H | 44.4% / 41.2% | 24.1% / 17.6% | 13.0% / 3.9% | 7.4% / 2.0% |
| **48H** | **53.7% / 54.9%** | **35.2% / 35.3%** | **24.1% / 13.7%** | **16.7% / 3.9%** |
| 72H | 51.9% / 49.0% | 35.2% / 39.2% | 24.1% / 21.6% | 16.7% / 7.8% |
| 7D | 42.6% / 41.2% | 33.3% / 39.2% | 27.8% / 35.3% | 25.9% / 21.6% |

- 结论：阈值移动 5%→20%，成功率在 **~55%→~4%** 之间摆动——**结论对标签定义高度敏感**，单点 34.6% 无意义。另：若误用 OR 逻辑，成功率虚增至 65–92%，故必须书面锁定 AND。

---

## 五、Normal Windows（P0）

- 全历史 48H 不重叠窗口：PEPE 438 个中 **362 个干净无突破**，DOGE **363 个**。声称的 5+7=12 仅占干净窗口的 **~1.7%**，且库中无生成代码 → 应视为人工抽样，**不能做 negative baseline**。
- 在 12 个样本上无法估计 False Alarm Rate / 月均误报；完整 725 个干净窗口上的 Setup 误报率**从未计算**。

---

## 六、Detector vs 完整 V2（P0，决定性）

独立基线（48H，MFE≥10% AND MAE≥-8%）：

- PEPE raw 37.1%，EP48 35.2%；DOGE raw 30.7%，EP48 35.3%；**合计 raw 98/290 = 33.8%**。
- 声称基础率 34.6% / walk-forward 33.1% 与裸 rolling 突破基线**在小数点后一位一致**。
- 而 Model1/2/3（+Volume / +Setup / +Environment+Veto）的增量表**不存在**，对应模块在库中**不存在**。因此 33.1% 测的只能是 **A：所有 rolling breakout**，完整 V2 的样本外增量 = **未证明（当前证据下为零）**。

---

## 七、权重调参泄漏（P1）

- V1 权重 `src/lib/config.ts:83-112` 头顶明确声明"候选规则、未经检验"（`:3-7`）——诚实，不判泄漏。
- V2 的 Setup/Trigger/Risk 权重与 Environment 阈值**无来源记录**；若如报告所示是在全历史表现上定的，则 Test→调参→再测同一集 = **Test Contamination**，在此之前任何"out-of-sample"表述不得使用。

---

## 八/九、Walk-forward 与类别不平衡（P1）

- 无 fold 定义、无 Train/Val/Test 划分代码，Campaign 隔离无法验证；仅有的均值 33.1% 无 mean/median/std，无 Precision/Recall/Specificity/FPR/FNR/PR-AUC/ROC-AUC。在干净窗口（725）远多于突破的现实下，只报成功率是误导性的。

---

## 十、D01 与 P10 独立复算（✅ 部分通过，⚠️ 附带关键反证）

- **D01**：复算确认 breakout 2024-11-06T00:00Z 收 0.21146 > 前 7 日高 0.1798；24H MFE **+0.87%**/MAE −11.76%，48/72H MFE **+0.87%**/MAE **−12.81%**——与声称 +0.9%/−12.8% 一致 ✅。但 7D MFE = **+108.08%**：同一事件换窗口即从 Failure 变大成功，标签窗口感知的铁证。且 V1 的 224% 是 21 天窗口峰值，与 72H MFE **不可比**，"V1 +224% vs V2 +0.9%"的对比是窗口口径 artifact。
- **P10**：V1 `breakoutTs=null` 确认（窗口内 0 根收盘超过前 7 日高 2.91e-06）✅；rolling-42 在窗内检出 3 连 trigger——证实这是**检测器定义差异**，且 3 打点同属一 episode，反向坐实第二章的重复计数问题。

D01 breakout 前后 4H K 线（UTC，`breakoutClose=0.21146`）：

| 时间（UTC） | close | high | low | 备注 |
|---|---|---|---|---|
| 2024-11-05 04:00 | 0.16773 | 0.16949 | 0.16145 | 前 5 根 |
| 2024-11-05 08:00 | 0.17151 | 0.17270 | 0.16585 | |
| 2024-11-05 12:00 | 0.17466 | 0.17990 | 0.16861 | |
| 2024-11-05 16:00 | 0.16779 | 0.17791 | 0.16570 | |
| 2024-11-05 20:00 | 0.16996 | 0.17363 | 0.16532 | |
| 2024-11-06 00:00 | **0.21146** | 0.22000 | 0.16901 | **BREAKOUT**（> pre7 高 0.1798）|
| 2024-11-06 04:00 起连续 18 根 | 0.19983 → 0.19938 | … | … | 详见审计输出；48/72H MFE +0.87%，MAE −12.81% |

---

## 十一、生产状态

- `CODE_COMPLETE`（V2）：❌ 无代码。
- `LOCAL_VALIDATED`：⚠️ 本环境缺 `node_modules`（`tsx` 不存在），`pnpm test` 无法执行，19 项全绿不可复验。
- `BACKTEST_VALIDATED`：❌。
- `PRODUCTION_DEPLOYED`：生产实测 `/api/market/health` 200 全绿、`status:live`——但部署的是 **V1**（六态雷达）。
- `PRODUCTION_DATA_VALIDATED`（V2）：❌。

---

## 十二、6 问答复与问题清单

1. **217 有多少真正独立？** 不可审计；同口径独立复算 raw=290，48H 去重后 **105**，7D 去重后 **70**。217 若未经去重，独立事件约仅 **1/3–1/2**。
2. **33.1% 测的是什么？** 裸 rolling 突破（A）。与独立基线 33.8% 一致，无证据含任何 V2 过滤增量。
3. **完整 V2 有样本外增量吗？** **无证明**（模块与增量表均不存在）。
4. **Setup 在普通行情误报率？** **未知**（725 个干净窗口从未被评分；12 个人工样本无效）。
5. **对阈值稳定吗？** **高度不稳定**（4%–57% 摆动）。
6. **可用于实时辅助判断吗？** **否。** 线上 V1 可继续作观测展示（须保留"已知缺口"标注）；任何 V2 预测性使用均不批准。

| 级别 | 问题 |
|---|---|
| P0 | 无 V2 扫描器/标签/walk-forward 源码，217/75/142/33.1% 全部不可审计 |
| P0 | 无 event clustering/cooldown，相邻 trigger 半数在 12H 内，重复计数实锤（膨胀 2.6–4.3×） |
| P0 | 标签 AND/OR 与窗口未定义；敏感性 4%–57%，单点成功率无效 |
| P0 | Normal 仅 12 个人工样本 vs 725 个干净窗口，baseline 无效，误报率未知 |
| P0 | 33.1% = 裸突破基线，完整 V2 增量为零证据 |
| P1 | V2 权重/阈值来源不明，疑似 Test Contamination；fold、隔离、方差、PR/ROC 全缺失 |
| P1 | V1 历史/实时两套突破定义并存，"统一 detector"不成立；`analysis.ts` 对 confirmed 的依赖仅靠调用方 |
| P2 | 本环境 `pnpm test` 不可执行（缺依赖），19 绿待复验；D01/P10 的跨口径对比需在 UI/方法论中澄清窗口差异 |

**放行条件**：提交 V2 扫描器与标签源码 → 锁定 AND + 窗口 → 落地 clustering/cooldown 并重报 Raw vs Independent → 全量 725 干净窗口误报率 → 分层增量回测（Baseline0/1 + Model1/2/3）→ 预注册阈值下的 walk-forward（分 fold 明细 + 精度/召回/FPR + PR-AUC）→ 权重来源声明。缺一不可，在此之前维持 **FAIL**。
