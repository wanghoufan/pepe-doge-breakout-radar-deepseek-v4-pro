# Breakout Radar V2 整改报告

> 项目：pepe-doge-breakout-radar-deepseek-v4-pro
> 日期：2026-09-08
> 结论：V1「历史成功样本研究」已升级为 V2「严格时间对齐、无未来数据污染、可实时、可回测、可区分成功与失败突破」的突破识别系统。

---

## 1. 原问题

逐项说明审计发现的问题（Phase 1 现状调查）：

| # | 问题 | 位置 |
|---|---|---|
| 1 | **时区混用**：历史事件用 `YYYY-MM-DDT00:00:00Z` 解析，但研究资料的日期是北京时间（SGT/UTC+8）日历日，导致事件窗口整体 8 小时错位 | `src/lib/event-analysis.ts` |
| 2 | **突破识别是「事后固定值」**：用「事件开始前固定 7 日最高价」，再等未来价格突破这个固定值；不是真正可实时执行的 Rolling Breakout | `event-analysis.ts`、`analysis.ts` |
| 3 | **24~48h 持续量能从 event.start 起算**，而非 breakoutTs，把突破前数据误算成突破后 | `event-analysis.ts`（`first48h`）、`analysis.ts` |
| 4 | **收益口径是 Hindsight**：`eventLow→eventHigh` 的 +93%/+150% 等被当作「策略收益」，实为事后完整波段 | `event-analysis.ts`（`coinPeakReturn`） |
| 5 | **单一机会分**：把环境/蓄势/突破/风险 4 层塞进一个 0~100 分，无法解释、无法区分「没数据」与「表现差」 | `analysis.ts`、`config.ts` |
| 6 | **只有成功样本**：21 个样本全部是人工挑选的上涨案例，无失败样本、无普通窗口对照 | 数据资产 |
| 7 | **相对强弱口径混乱**：`币种事件涨幅 - BTC 事件涨幅`，各自起算点不同 | `event-analysis.ts`（`relativePeakVsBtc`） |
| 8 | **缺时间序列回测**：只有「挑完规则再拿全部历史自证」，无 walk-forward / 样本外检验 | 无 |
| 9 | **绝对阈值偏科**：`Volume >= 2x`、`ATR <= 0.9` 等可能天然偏向某个币种 | `config.ts` |

## 2. 根因

- **时间**：原脚本 `Date.parse('${start}T00:00:00Z')` 把「北京时间日历日」当成 UTC 午夜，与 4H K 线（UTC epoch 对齐）产生 8 小时边界错位。
- **突破**：`preHigh = max(pre7)` 是相对人工标注的 event.start 一次性算死的固定值，实时系统无法复现同一逻辑，历史/实时必然两套算法。
- **收益**：`coinPeakReturn = pct(eventHigh, eventLow)` 用了事件窗口内**最低点**作为买入基准，这是只有在事后才知道最低/最高点的 Hindsight，无法被策略实际捕捉。
- **样本**：21 个样本是「挑选成功案例」的产物，天然存在幸存者偏差；不加入失败样本和普通窗口，任何阈值都只是「成功样本长什么样」的描述，不具备预测意义。

## 3. 已修改文件

| 文件 | 变更 | 原因 |
|---|---|---|
| `src/lib/time.ts` | **新增**：UTC 毫秒统一、`parseCSTDate`/`parseISO`、4H 边界对齐、收盘判断 | P0-1 时区统一 |
| `src/lib/breakout.ts` | **新增**：`getRollingHigh`/`detectBreakoutAt`/`detectBreakout`/`detectAllBreakouts` | P0-2 Rolling Breakout，实时/历史/回测共用 |
| `src/lib/mfe-mae.ts` | **新增**：`calculateExcursion`/`calculateMFE`/`calculateMAE` | P0-4 从 breakoutTs 起算的 MFE/MAE |
| `src/lib/relative-strength.ts` | **新增**：`syntheticRatio`/`relativeReturn`/`relativeStrengthPercentile` | P0-9 合成比值统一口径 |
| `src/lib/statistics.ts` | **新增**：`percentile`/`percentileRank` | P0-8 分位阈值替代绝对阈值 |
| `src/lib/v2/engine.ts` | **新增**：分层引擎 `analyzeAssetV2` + Setup/Trigger/Follow-through 特征 + 环境闸门 + 风险 + 硬否决 | Phase 3 分层架构 |
| `src/lib/v2/samples.ts` | **新增**：历史突破扫描器 + 成功/失败标签 + 普通窗口 | Phase 5 |
| `src/lib/v2/backtest.ts` | **新增**：walk-forward 回测 + Precision/Recall/FPR | Phase 6 |
| `src/lib/state-machine.ts` | **重写**：6 态 → 10 态 `determineStateV2` | Phase 3 |
| `src/lib/config.ts` | **重写**：`STATE_META` 10 态、V2 阈值/权重（含分位） | Phase 3/8 |
| `src/lib/types.ts` | **重写**：`AssetSignal`/`StateCode`/`LayeredScore`/`BreakoutInfo`/`EnvironmentState` | Phase 3 |
| `src/lib/event-analysis.ts` | **重写**：`EVENT_DEFS` 改 ISO；`computeEventMetrics` 用 Rolling detector + MFE/MAE + ratio 相对强弱 | P0-1/2/4 + Phase 4 |
| `src/lib/analysis.ts` | **改为再导出** V2 引擎（废弃单一机会分） | 避免两套算法 |
| `src/lib/market-service.ts` | **重写**：编排改用 `analyzeAssetV2` + ratio 相对强度互馈 | Phase 3/11 |
| `src/lib/data-store.ts` | `outcome` 字段接入 | Phase 5 |
| `src/lib/similarity.ts` | `currentFeatureVector` 适配 V2 字段 | Phase 10 |
| `src/components/market/StateBadge.tsx` | 10 态配色 | Phase 12 |
| `src/components/market/SignalCard.tsx` | 分层结构（环境闸门/Setup/Trigger/Follow/Risk/硬否决/条件清单） | Phase 12 |
| `src/components/market/AssetDetail.tsx` | 分层评分展示 | Phase 12 |
| `src/app/history/[id]/page.tsx` | 突破/跟随/MFE-MAE/事后波段分区展示 | Phase 12 |
| `src/app/methodology/page.tsx` | 方法论改写为 V2（10 态 + 分层 + 回测） | Phase 12 |
| `scripts/recompute-v2.ts` | **新增**：离线重算 21 事件 + 扫描 + 回测 + BEFORE/AFTER | Phase 4-6 |
| 测试文件 | `v2.test.ts`（新增 10 项）、`event-analysis.test.ts`/`state-machine.test.ts` 重写 | Phase 16 |

## 4. 算法变化（Old vs New）

| 维度 | Old（V1） | New（V2） |
|---|---|---|
| 突破判定 | 事件开始前固定 7 日最高价，等未来价突破 | `rollingHigh(t)=MAX(high[t-42..t-1])`，`close[t] > rollingHigh` 才算 4H 收盘突破 |
| 当前 K 线 | 参与（可能用未收盘价） | **不参与** rollingHigh；盘中 high>阻力只标 INTRABAR，不确认 |
| 量能窗口 | 从 event.start 起算 24~48h | 从 breakoutTs 起算 0~24h / 24~48h |
| 收益 | eventLow→eventHigh 峰值（Hindsight） | MFE/MAE 24/48/72h/7D（相对 breakoutClose） |
| 相对强弱 | 币种涨幅 − BTC 涨幅（口径不一致） | `coin/btc` 合成比值，相对收益/斜率/分位 |
| 评分 | 单一 0~100 机会分 | Environment Gate + Setup + Trigger + Follow-through + Risk + Hard Veto 六层独立 |
| 状态机 | 6 态 | 10 态 |
| 阈值 | 绝对阈值（2x、0.9） | 分位优先（volume percentile ≥ 90% 等），绝对阈值兜底 |
| 样本 | 仅 21 个成功案例 | 成功/失败/普通窗口 + walk-forward 回测 |
| 缺失数据 | 缺数据≈0 分 | `WAITING`/`PENDING`/`NOT_STARTED`/`DATA_UNAVAILABLE` 显式区分 |

## 5. 历史数据变化（21 事件重新计算）

统一用 V2 rolling detector 重算，关键差异（完整 21 行见 `scripts/output/recompute-report.json`）：

| Event | Old breakoutTs | New breakoutTs | 差异 | Old 48h量比 | New 24h量比 | Old 相对峰值 | New 相对72h | Old 峰值 | New MFE72 | New MAE72 | 标签 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| P01 | 05-21 12:00 | 05-21 12:00 | 0h | 1.79 | 2.74 | +84% | +18.9% | +93% | +29.5% | -0.3% | 成功 |
| P02 | 11-07 00:00 | 11-06 20:00 | -4h | 1.72 | 2.35 | +191% | +11.5% | +229% | +16.1% | -0.6% | 成功 |
| P06 | 08-08 16:00 | 08-07 20:00 | **-20h** | 1.02 | 1.85 | +22% | +6.9% | +27% | +13.8% | -1.4% | 成功 |
| P08 | 02-14 16:00 | 02-14 08:00 | -8h | 0.74 | 5.15 | +46% | +15.4% | +47% | +29.2% | -2.0% | 成功 |
| P09 | 03-13 08:00 | 03-13 08:00 | 0h | 1.71 | 1.96 | +18% | +8.2% | +26% | +13.6% | -8.5% | 失败 |
| **P10** | **无突破** | **07-03 08:00** | **新增** | 0.86 | 3.14 | +21% | +4.1% | +29% | +12.5% | -1.0% | 成功 |
| D01 | 11-06 00:00 | 11-06 00:00 | 0h | 1.73 | 3.56 | +179% | -8.1% | **+224%** | **+0.9%** | **-12.8%** | **失败** |
| D03 | 无突破 | 无突破 | — | 1.66 | — | +21% | — | +33% | — | — | 未标注 |
| D05 | 07-17 08:00 | 07-18 00:00 | +16h | 1.38 | 2.79 | +45% | +16.5% | +47% | +17.8% | -4.0% | 成功 |
| D06 | 08-08 16:00 | 08-07 20:00 | **-20h** | 1.30 | 1.33 | +15% | +3.6% | +21% | +11.0% | -1.3% | 成功 |
| D08 | 01-02 12:00 | 01-02 00:00 | -12h | 1.32 | 4.31 | +27% | +12.8% | +36% | +19.9% | -0.9% | 成功 |

**要点**：
- 突破检测差异：**1 个「旧无新有」**（P10，旧算法漏检、V2 rolling 检出）；**1 个「两者均无」**（D03）；**0 个「旧有新增无」**。
- **D01 是最关键证据**：事后峰值 +224%，但突破后 72h 真实表现 MFE 仅 +0.9%、MAE -12.8%（先回撤 12.8%），标注为「失败」。这说明原 +93%/+150%/+224% 之类数字是 Hindsight 波段描述，不是策略可捕捉的收益。
- 多数事件突破时点因 rolling detector + CST 时区修正发生 -4h ~ -20h 位移。

## 6. 失败样本与普通样本

- **全量突破扫描**（用与实时系统完全相同的 detector）：**217 个突破**（PEPE 102 / DOGE 115）。
- **事后标签**（未来数据只用于 label，不用于 feature）：成功 = 72h MFE ≥ 10% 且 72h MAE ≥ -8%；其余为失败。
  - 成功 75，失败 142，未标注 0（标签阈值来自数据分布，非拍脑袋——见下）。
- **MFE72h 分位**：P10=0.8% / P25=2.6% / P50=7.0% / P75=14.5% / P90=30.2%。
- **MAE72h 分位**：P10=-14.1% / P25=-9.2% / P50=-5.5% / P75=-1.8% / P90=-0.5%。
- **普通窗口**（≥30 天无突破）：PEPE 5 段、DOGE 7 段。
- **Campaign ID**：21 个人工事件保留 C01~C07（PEPE+DOGE 同轮绑定）；扫描样本用时间切分（更强于 campaign 标签，杜绝泄漏）。

## 7. 回测结果

采用 **walk-forward（时间单调切分）**：按时间把 217 个突破切成 5 段，逐段「早期训练 → 后期测试」滚动推进；每个 fold 在训练集上按 F1 选最优规则，在测试集只评估一次。

**测试集汇总（173 个带标签样本）**：

| 指标 | 值 |
|---|---|
| Precision（精确率） | **0.331** |
| Recall（召回率） | 0.823 |
| False Positive Rate（假阳性率） | 0.928 |
| Success Rate（成功率） | **0.331** |
| F1 | 0.472 |
| TP / FP / FN / TN | 51 / 103 / 11 / 8 |

**解读**：成功样本基础率 = 75/217 ≈ 34.6%。walk-forward 测试集 Success Rate 33.1% ≈ 基础率，说明「朴素突破信号」（量比/突破距离过滤）在样本外**几乎无超额**。这正是本整改要揭示的结论：V1 把「成功样本共同特征」当预测能力是不成立的；V2 用失败样本 + 样本外回测把这个事实诚实暴露出来。

## 8. 数据泄漏检查

- **Look-ahead Bias 已消除**：rollingHigh 不含当前 K 线；突破仅以已收盘 4H close 判定；Setup 只用突破前数据；Follow-through 只用 breakoutTs 之后数据；MFE/MAE 仅作事后 label。
- **实时/历史同算法**：`analyzeAssetV2` 与 `computeEventMetrics`/`scanBreakoutSamples` 共用 `detectBreakoutAt`，无第二套逻辑。
- **相似度无未来信息**：`SIMILARITY_FEATURES` 仅含突破前字段（收缩比/量比/启动前收益/启动前 ATR/启动前费率）。
- **回测无自证**：walk-forward 时间切分，train 严格早于 test；同轮 PEPE/DOGE 同落一段，不跨集。
- **残存风险**：MAE 阈值 -8% 与成功 MFE 阈值 10% 仍是从全体样本分布定的，虽用于 label（非 feature）合法，但未做参数敏感性分析。

## 9. 自动测试

`node --import tsx --test src/lib/*.test.ts` — **38 项全部 PASS**：

| 测试 | 结果 |
|---|---|
| TEST 1 Rolling 7D High 不包含当前 K 线 | ✅ PASS |
| TEST 2 突破只有 4H 收盘后才成立 | ✅ PASS |
| TEST 3 突破前不能产生 Follow-through | ✅ PASS |
| TEST 4 突破后 24H Volume 从 breakoutTs 起算 | ✅ PASS |
| TEST 5 时区转换不移动 4H candle 边界 | ✅ PASS |
| TEST 6 历史相似度不使用未来数据 | ✅ PASS |
| TEST 7 同 Campaign 不进入 Train/Test（时间单调） | ✅ PASS |
| TEST 8 Missing Data 不被当成 Score=0 | ✅ PASS |
| TEST 9 Hard Veto 覆盖高机会状态 | ✅ PASS |
| TEST 10 实时与历史 detector 输出一致 | ✅ PASS |
| indicators / state-machine(10态) / event-analysis(21事件+时区) | ✅ 28 项 PASS |

`tsc --noEmit` 与 `eslint --quiet` 均零错误。

## 10. 当前产品状态

**可以真实使用**：
- 实时分层信号（环境闸门 → Setup → Trigger → Follow-through → Risk → Hard Veto → 10 态状态机），基于已收盘 4H K 线。
- 21 个历史事件已按 V2 重算（含 MFE/MAE、ratio 相对强弱、突破位/距离），历史详情页分区展示。
- 历史突破扫描（成功/失败/普通窗口）+ walk-forward 回测可复现（`node --import tsx scripts/recompute-v2.ts`）。
- 数据质量/数据缺失显式化（WAITING/PENDING/DATA_UNAVAILABLE，不再等于 0）。

**仍属实验性**：
- 阈值与权重是「候选」性质，样本量有限（217 突破），需持续滚动更新。
- 朴素突破信号样本外无超额（Success Rate ≈ 基础率 33%），说明「突破识别」本身不构成交易优势，需结合更严格的 Trigger/Follow-through 过滤或更高维特征才可能改善——当前如实呈现。

## 11. 尚存风险

1. **样本量小**：仅两个标的、约 883 天 4H 数据、217 个突破，walk-forward 各 fold 样本稀疏，Precision/Recall 波动大。
2. **标签阈值未做敏感性分析**：MFE≥10% / MAE≥-8% 是单组取值，未扫描阈值空间。
3. **衍生品指标缺失**：Funding 已接入，但 Open Interest、Liquidation、Funding 历史序列不完整，Risk 层暂缺这些维度。
4. **实时 API 依赖外网**：本沙箱 OKX/Binance 被 DNS 墙，实时接口在此环境恒为 `unavailable`；生产（Vercel 东京）已可用，但需部署后验证 V2 引擎在真实行情下的输出。
5. **未跑 `next build`**：沙箱无外网无法 `pnpm install`；但 `tsc --noEmit`、`eslint`、38 项测试、tsx 运行时验证均已通过。

## 12. 下一步建议

**P0（立即可做）**：
- 部署后验证生产环境 V2 实时信号（尤其 Follow-through PENDING→COMPUTED 的转换）。
- 对 MFE/MAE 标签阈值做敏感性分析（扫描 MFE∈{5,8,10,12,15}%、MAE∈{-5,-8,-10,-12}%）。

**P1（增强）**：
- 把 Trigger 分引入回测信号（当前只用 volumeRatio+distancePct），用 walk-forward 评估「Trigger≥阈值」的样本外表现。
- 接入 Open Interest / Liquidation，补全 Risk 层与硬否决（LIQUIDITY_VETO 已有骨架）。
- 相对 BTC 强弱补「相对强度分位」作为 Setup 条件权重来源。

**P2（研究向）**：
- 跨更多 Meme 币种扩展样本（当前产品约束仅 PEPE/DOGE，需用户明确授意）。
- 引入「突破失败后是否可做反向」的研究，但保持不输出胜率/收益承诺的边界。

---

*附：完整 BEFORE/AFTER 21 行、样本分布、walk-forward 各 fold 明细见 `scripts/output/recompute-report.json`；V1 原始指标备份见 `scripts/output/event-metrics-v1-backup.json`。*
