# CODE_REVIEW（代码审查报告）

> 审查角色：代码审查工程师（独立审查，不默认实现正确）
> 初审：2026-09-08（UTC），HEAD `505ef64` ｜ **复审：2026-09-08（UTC），HEAD `4d7c724`**（见 §7）
> 审查范围：`505ef64`（Action Card UX 决策解释层）为主；`3d6ea05`（V2 整改冻结）+ `dad7e77`（冻结后评估产出）为必要的回归/口径上下文
> 验证手段：源码阅读 + `pnpm test` + `pnpm ts-check` + `pnpm lint:build` + 文案禁用语扫描 + API/状态链路走查（复审追加：截图像素验真 + fmtNum 行为实测）

## 0. 基线声明（重要偏离）

任务要求先读 `docs/roles/code-reviewer.md`，再按角色职责/流程/权限/输出规范执行，并参考 `docs/pm/PLAN.md`、`docs/qa/BUGS.md`。

**实际基线**：本仓库不存在 `docs/` 目录（已用 `ls`/`glob` 确认），因此以下文件全部缺失：

- `docs/roles/code-reviewer.md`（无角色定义、无工作流程、无权限边界、无输出规范）
- `docs/pm/PLAN.md`（无原始需求/计划文档）
- `docs/qa/BUGS.md`
- `docs/review/CODE_REVIEW.md`（本文件为首次创建）

`AGENTS.md` 亦不包含任何多角色工作流说明，它只是项目上下文（技术栈/目录/接口/长期约束）。

**替代基线**（已实际执行）：`AGENTS.md` 长期约束 + `git log/diff` 确定的本轮改动 + 各轮报告
（`ACTION_CARD_REPORT.md` / `V2_IMPLEMENTATION_REPORT.md` / `V2_DELIVERY_FORENSICS.md` /
`BACKTEST_PROTOCOL_V1.md` / `V2-audit-report-2026-09-08.md`）+ 相关源码与测试。
“当前任务”正文为空，已按“审查最新提交（Action Card）+ 回归 V2 整改链路”界定范围。
本偏离不 blocking，但建议补齐角色与计划文档，或修正任务模板。

关于 `V2-audit-report-2026-09-08.md`（未跟踪文件，HEAD 为 `052b743` 时的快照审计，结论 FAIL“仓库无 V2 代码”）：
经 `V2_DELIVERY_FORENSICS.md` 取证 + 本次复核，`052b743` 恰为 V2 提交 `7a22aaa` 的父提交，
“无 V2 代码”仅对该快照成立；`7a22aaa` 起 `src/lib/breakout.ts` / `src/lib/v2/` / `src/lib/mfe-mae.ts`
真实存在且已同步远端。审计报告的定量复算（重复计数/标签敏感性/normal 覆盖）仍有价值，
但“无代码”结论已过期，不得再作为否决依据。

## 1. 结论

- **Action Card 本轮（`505ef64`）：条件通过（Conditional PASS）。**
  UX/决策解释层实现完整、测试充分、文案合规（无开仓/买入/胜率表述），未改动底层量化策略。
  唯一要求修复的是 1 个中等严重程度的事实准确性问题（§2.1 REJECT 文案过度泛化），修后可合入。
- **V2 整改链路（`7a22aaa`→`3d6ea05`→`dad7e77`）：方法论闭环完成，结论诚实，状态为 PARTIAL。**
  Episode 去重 / AND 标签 / 全量 normal 窗口 / 增量回测 / campaign walk-forward / 协议冻结均已落地；
  但诚实结论同样是 M1–M4 样本外无增量（ROC-AUC≈0.5）、M5 待新 holdout——**不得包装为可预测/可部署的生产策略**。
- **回归**：`pnpm test` **69/69 通过**，`tsc` 零错误，`eslint --quiet` 零告警。无回归。
- **未修改业务代码**：本次审查只新增本报告文件，未触碰任何源码（符合“无明确授权不改业务代码”）。

## 2. 问题清单

### 2.1 [Medium · 事实准确性] REJECT 分支文案对所有否决原因使用同一“跌破失效位”表述

位置：`src/lib/action.ts:264-293`（`deriveActionState` REJECT 分支）

```ts
summary: `当前价格已经跌破结构失效位，本轮突破结构失效。${ageNote}`,
reasons: [ envOk?, veto?, '本轮币种结构已失效', (price<invalidation? ...) ]
```

触发条件包括 `hardVeto!=='NONE' || !envOk || FAILED/INVALIDATED/MARKET_BLOCKED`，
即 BTC_VETO / DATA_VETO / 环境 BLOCK（即使从未发生过突破、`breakoutLevel/invalidationLevel` 为 null）
也会显示“已经跌破结构失效位”+ 无条件 reasons“本轮币种结构已失效”。
与 AGENTS.md“必须可解释：值+证据来源+时间戳+新鲜度”冲突：无值 placements 却断言跌破。

现有测试未覆盖：`action.test.ts` TEST 2 只断言 reasons 含 BLOCK，不校验 summary；
TEST 1/11 均为 STRUCTURE_VETO 真实失效场景，掩盖了泛化分支。

**建议修复**（纯文案分支，不改优先级）：按 `hardVetoKind` 与关键价位是否存在分支 summary/reasons，
例如 DATA_VETO→“数据不足以判定结构”；BTC_VETO/环境 BLOCK→“环境禁止跟踪，本轮不进入观察”；
仅当 `invalidationLevel != null && currentPrice != null && currentPrice < invalidationLevel`
或 `state ∈ {FAILED_BREAKOUT, INVALIDATED}` 时才使用“跌破失效位”表述。
需补 2–3 个测试（BTC_VETO 无突破 → 非“跌破”文案；env BLOCK 无突破 → 同上）。

### 2.2 [P1 · 治理] AGENTS.md 长期约束文本与 V2 研究产出存在字面冲突，需所有者裁决

`AGENTS.md` 长期约束原文（`3d6ea05` 仅改了 test 命令行，本约束未动）：

- “历史维度不设普通行情对照窗口，也不设失败样本对照” ↔ V2 新增 768 全量 normal 窗口 + episode success/failure（AND）标签
- “不输出胜率、准确率、假突破概率” ↔ 报告输出 precision/recall/successRate，方法论 UI 输出“BUILDING误报率约41%/NEAR约30%”

本次核查确认：**面向用户的实时信号层合规**——`ActionCard/SignalCard/AssetDetail/methodology` 经禁用语扫描，
仅出现否定式合规表述（“不是开仓信号”“不输出胜率”“不代表未来收益概率”），`action.test.ts` TEST 14/15 覆盖 8 类禁用语；
`methodology` 的误报率/ROC-AUC≈0.5/M5 待验证表述均带“不承诺收益”护栏，属于“已知缺口如实标注”的诚实披露。
冲突仅存在于**研究层产物**（reports + 方法论文案数字）与约束字面之间。

**建议**：二选一并落字到 `AGENTS.md`——（A）将约束澄清为“实时信号层不输出胜率/开仓建议；
研究层允许 normal-window/标签/回测指标，但必须标注口径且不承诺收益”；（B）从 UI 文案中移除误报率数字。
在裁决前维持现状，不得把报告中的 precision/successRate 包装进任何信号 UI。

### 2.3 [Low] 次要实现异味（不 blocking，建议顺手清理）

1. `src/lib/v2/episode.ts:163-164,217-218`：`build.state = 'BREAKOUT_TRIGGERED'` 后立即覆盖为
   `'ACTIVE_BREAKOUT'`，前者永远不可观测。删其一或明确两态语义。
2. `src/lib/v2/backtest.ts:347-349`：`buildEpisodeFeatureRows` 回测侧 veto 以 `invalidated=false` 硬编码，
   故 STRUCTURE_VETO 永不触发，M4 相对 M3 的实际增量仅剩 BTC/DATA veto。逻辑自洽（trigger 时刻本就不该知道未来失效），
   但 M4 解读时须如实说明，避免读者误以为含结构失效过滤。
3. `src/lib/v2/engine.ts:730`：Risk 恒为 `COMPUTED`（缺 funding 时仍计 0 分），存在低估可能；
   现有 `dataQuality.degraded/missingFields` 已部分对冲。建议 funding 缺失时 Entry Heat 显示“未知”而非“低”。
4. `src/lib/market-service.ts:49,226`：`status` 类型含 `'partial'` 但从不产生（仅 live/unavailable）；
   `AssetDetail.tsx:96-98` 的 `forcedStatus: live?'ok':'stale'` 之 stale 路径实际不可达（不可达时 signals 为 null，
   走 null→unavailable 分支）。防御性代码无害，但 stale 分支会清空 keyLevels，若未来引入 partial+signals
   需重审该行为。
5. `src/lib/analysis.ts`（V1 引擎）已无任何引用方（`market-service` 只用 `analyzeAssetV2`），属死代码；
   测试全绿证明无回归，但应择机归档/删除以降低维护负担。注意勿动 `indicators.ts` 算法（与历史脚本逐行等价约束）。

## 3. 分项审查

| 维度 | 结论 | 证据 |
|---|---|---|
| 需求实现完整性 | Action Card 7 态 + 优先级 + 灰化 + 改名 + 方法论同步，完整 | `action.ts:209-434` 优先级链与 `methodology/page.tsx:157-195` 优先级文案一致；`SignalCard:81,100-114` 置顶+灰化；`AssetDetail:177,205-213` 同步 |
| 逻辑 Bug | 1 中（§2.1）+ 若干低级异味（§2.3） | 见上 |
| 数据一致性 | 通过 | UTC 存储（`types.ts:5`，`event-analysis.ts:85-86` Z 后缀）/ Asia/Shanghai 展示（`format.ts:3-17`）；当前 K 线不参与 rollingHigh（`breakout.ts:60-67,79-82`）；突破后窗口不含突破 K 线（`mfe-mae.ts:50`，测试覆盖）；Setup 仅用突破前前缀（`backtest.ts:309`）；缺失≠0（`remediation.test.ts` TEST 15，`state-machine` null→NO_SETUP） |
| 状态和异步 | 通过 | `determineStateV2` 否决优先链正确（`state-machine.ts:37-63`）；`use-api.ts` abort 清理正确，无轮询风暴；`market-service` 全独立请求+失败聚合+绝不用快照冒充（`market-service.ts:104-143,168-172,224-226`）；`LiveRadar` 未传 dataStatus 但与 service“非 live 即 signals null” invariant 组合正确（走查确认）；API 参数校验完备（`candles/route.ts:18-25` coin/bar/limit clamp，`similarity/current` coin 白名单 + 非 live→unavailable） |
| 回归风险 | 无 | 69/69（54 旧 + 15 action 新增；旧 38 V2 + remediation 16 均在内），tsc/eslint 干净；Action 层 display-only 阈值（Heat 70/40，FT 60/35）不参与交易判定与回测（源码注释 + `ACTION_CARD_REPORT.md` §8 声明）；`types.ts` 仅加 4 可选字段，老消费者不受影响 |
| 性能 | 通过 | 实时路径 `analyzeAssetV2`（120 根级，episode 重建 O(n·42)）为毫秒级；`buildEpisodeFeatureRows` 重计算仅离线脚本使用；`market-client` 具超时（`AbortSignal.timeout`）+ 内存缓存 + 在途去重 |
| 安全 | 通过 | 前端不直连第三方（服务端代理）；无密钥/无 PII；无 `eval`/dangerouslySetInnerHTML；API 无开放重定向/SSRF（URL 服务端固定，仅 coin/bar/limit 受控参数） |
| 可维护性 | 良好，附清理建议 | 配置集中（`config.ts`，阈值/权重/STATE_META/ASSETS）；纯函数可测（action/episode/outcomes/backtest 全纯）；协议机器可读（`protocol.ts` + `checkProtocolCompliance`）；死代码 `analysis.ts` 与 §2.3 若干小项待清理 |
| 长期约束符合性 | 信号层合规，研究层字面冲突待裁决 | 见 §2.2；品类约束遵守（仅 PEPE/DOGE+BTC，无扩品）；“滚仓计算器”无交叉引用；截图/快照 JSON 未改动 |

## 4. 验证记录（可复现）

- `pnpm test`：69 tests / 69 pass / 0 fail（`src/lib/*.test.ts` + `src/lib/v2/*.test.ts`）
- `pnpm ts-check`（`tsc -p tsconfig.json`）：零错误
- `pnpm lint:build`（`eslint . --quiet`）：零告警
- 禁用语扫描：`rg "胜率|准确率|假突破概率|建议开仓|买入|开仓"` 仅命中合规否定式表述（详见审查过程记录），信号 UI 无收益承诺
- 未执行项：生产实时链路（沙箱无外网，OKX 恒 unavailable，属预期；`ACTION_CARD_REPORT.md` §9 以 SSR markup + 直出 JSON 作为等效证据，合理）

## 5. 放行条件

1. 修复 §2.1（REJECT 文案按否决种类/关键价位分支 + 补测试），复跑 `pnpm test && pnpm ts-check && pnpm lint:build` 全绿。
2. §2.2 由需求所有者书面裁决并更新 `AGENTS.md` 约束措辞（审查不代裁）。
3. 在此之前：维持 V2 方法论 **PARTIAL** 定级；Action Card 可合入（展示层），任何基于 M1–M5 的推送/仓位/胜率表述一律不批准。

## 6. 附录：审阅文件清单

改动（`505ef64`）：`src/lib/action.ts`（507 行）/ `src/lib/action.test.ts`（15 项）/
`src/components/market/ActionCard.tsx` / `SignalCard.tsx` / `AssetDetail.tsx` / `src/app/methodology/page.tsx` /
`ACTION_CARD_REPORT.md`
上下文（`3d6ea05`/`dad7e77`）：`src/lib/v2/episode.ts` / `outcomes.ts` / `normal-windows.ts` /
`protocol.ts` / `engine.ts` / `backtest.ts` / `remediation.test.ts` / `src/lib/breakout.ts` /
`mfe-mae.ts` / `state-machine.ts` / `types.ts` / `config.ts` / `market-service.ts` / `market-client.ts` /
`format.ts` / `hooks/use-api.ts` / `app/api/**` / `LiveRadar.tsx` / `page.tsx`
报告：`V2_IMPLEMENTATION_REPORT.md` / `V2_DELIVERY_FORENSICS.md` / `BACKTEST_PROTOCOL_V1.md` /
`V2-audit-report-2026-09-08.md`（已过期部分，见 §0）

## 7. 复审（HEAD `4d7c724`，2026-09-08 UTC）

复审范围：`505ef64..4d7c724`（`fix(radar): Action Card 真机验证修复 + 真实截图`，4 文件，+20/−9）。

### 7.1 上轮问题复验

| 上轮问题 | 状态 |
|---|---|
| §2.1 REJECT 文案过度泛化（`action.ts:265-294`） | ❌ **未修复**：逐行比对确认该分支一字未动，放行条件 §5.1 仍然有效 |
| §2.2 AGENTS 约束字面冲突 | ❌ **未裁决**：`AGENTS.md` 零改动，维持 §5.2 |
| §2.3 次要异味（死赋值/回测 veto/Risk 0/`partial` 死类型/V1 死代码） | ❌ **均未动**：`BREAKOUT_TRIGGERED` 死赋值（`episode.ts:163,217`）、`analysis.ts` 零引用均复验仍在 |

### 7.2 新增改动审查

1. **`fmtNum` 浮点修复（`action.ts:154-158`）✅ 通过**：`String(v)`→`String(parseFloat(v.toPrecision(6)))`，
   另补 `!Number.isFinite` 守卫（NaN/Infinity  previously 会渲染为“NaN”）。
   实测：`0.08957259999999999→"0.0895726"`、`3.607e-6→"0.000003607"`（PEPE 精度无损）、`NaN/Inf/null→"—"`。
   纯展示、无策略影响、无测试回归（69/69）。两个注记（Low）：
   - 注释与报告写作“→0.089573”，实际输出为 `"0.0895726"`（6 位有效数字），文档数字与实现差一位，建议订正注释。
   - 6 位有效数字对 BTC 量级会丢小数（实测 `108234.567→"108235"`）；当前 `fmtNum` 仅用于币种价位（PEPE/DOGE <1），
     无实际影响，但该 helper 若日后复用于 BTC 展示需改用 `formatPrice`。
2. **真机截图 ✅ 采信（附保留）**：逐像素验真两张 PNG。
   HOME 图与报告 §9 一致（OKX 在线、PEPE 🔴当前淘汰 408h/3.6510e-6/4.0970e-6/3.6463e-6/3.8790e-6；
   DOGE 🔵回踩重点观察 0.0913/0.0900/0.0896/0.0953；BTC 79,419.9/+0.27%/−2.40%/EMA100 上方），
   与 `action.test.ts` TEST 11/12 场景交叉一致；LEVELS 图灰化分区/STRUCTURE_VETO 横幅/三条接下来观察与代码渲染路径一致；
   全程无禁用语。保留项：本沙箱无外网，live 取值不可复现，采信但记为“单方 live 证据”；
   价格相对初审直出值发生漂移（PEPE 3.607e-6→3.6510e-6、DOGE 0.0907→0.0913），属实时数据正常移动，非不一致。
3. **新发现 [Low] 同一价位双轨格式化**：LEVELS 图实证——同一突破位在 KeyPrice 区显示 `0.0900`
  （`formatPrice`，≥0.01 取 4 位小数）而在“接下来观察”显示 `0.08995`（`fmtNum`/原 `String`，6 位有效数字）；
   同理 `0.0953` vs `0.09529`。根因为价格显示走了 `formatPrice` 与 `fmtNum` 两套格式化。
   建议统一用 `formatPrice` 渲染所有价格文案（含 `nextConditions`），`fmtNum` 仅保留给百分比类或删除。
   另：LEVELS 图中 `0.08957259999999999` 系修复前实拍，作为 before-证据诚实但永久留存；建议补一张修复后同位置截图以闭环。
4. **仓库卫生 [Low]**：两张 PNG（共 ~1.2MB 二进制）置于仓库根目录，而 `AGENTS.md` 约定截图位于
   `public/screenshots/`（P01..P11/D01..D10）。建议移入 `public/screenshots/` 或 `docs/` 配图目录并更新报告引用。

### 7.3 复审验证

- `pnpm test`：69/69 通过（无新增测试——fmtNum 未导出、无单测；可接受但建议将格式化 helper 导出并补用例，含上述双轨一致性用例）
- `pnpm ts-check`：零错误 ｜ `pnpm lint:build`：零告警
- 禁用语重扫：仅命中合规否定式表述，与初审一致
- `docs/roles/code-reviewer.md` / `docs/pm/PLAN.md` / `docs/qa/BUGS.md`：复验仍缺失（仅 `docs/review/CODE_REVIEW.md` 存在，即本文件）

### 7.4 复审结论

**维持初审结论**：Action Card 条件通过（§5 放行条件不变，§2.1 仍为合入前置修复）；
本次 `fmtNum` 修复与截图证据质量良好，不改变定级。新增建议（不 blocking）：订正 fmtNum 注释数字、
统一价格格式化（§7.2.3）、截图归位（§7.2.4）、为格式化 helper 补单测。
