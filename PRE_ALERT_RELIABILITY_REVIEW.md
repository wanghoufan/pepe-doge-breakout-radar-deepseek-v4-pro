# PRE_ALERT_RELIABILITY_REVIEW（P1 预警可靠性评审）

> 绑定 task：task_327155bf0a50 ｜ 生成时间（UTC+8）：2026-09-08 ~16:50（生产 serverTime 08:45Z 实测）
> 唯一结论口径：PASS_CANDIDATE / PARTIAL / BLOCKED（三选一，见§14）。

---

## §1 任务与禁令遵守

- 任务：P1-1 手机端 ActionCard 走查（375/390/430）+ 响应式修复（不重做视觉）；P1-2 方案A落字（研究指标仅离线研究用）；P1-3 新建 `LIVE_CASE_EVIDENCE_TEMPLATE.md`。
- 禁令：禁 push、禁 deploy（动生产需用户另批）；禁调阈值/权重/M5。遵守情况：无 push、无 deploy（§12 铁证：生产仍为 HEAD 内容）；`config.ts` / `indicators.ts` / `state-machine.ts` / `backtest.ts` 零 diff（§7）。

## §2 基线：HEAD / 分支 / 工作树状态

- repo：`pepe-doge-breakout-radar-deepseek-v4-pro`，分支 `main`。
- HEAD：`e55b0a6ad0955e3d7c24d4f1018d75bde3aa07e3`（与 T6 结束时一致，无新 commit）。
- 工作树：DIRTY（T6 P0 脏改未提交 + 本轮 P1 改动未提交，均未 commit，符合"改动未 commit 续作"前提）。
  - tracked modified（11）：`AGENTS.md`、`src/app/api/market/overview/route.ts`、`src/app/methodology/page.tsx`、`src/components/market/{ActionCard,AssetDetail,DataStatus,HistoryGrid,LiveRadar,SignalCard}.tsx`、`src/lib/market-service.ts`、`src/lib/v2/engine.ts`。
  - untracked（3）：`CURRENT_STAGE_REVIEW_HANDOFF.md`（T6 遗留）、`LIVE_CASE_EVIDENCE_TEMPLATE.md`（本轮 P1-3 新增）、`src/lib/freshness.ts` + `src/lib/freshness.test.ts`（T6 P0 新增）。
- 说明：`next-env.d.ts` 在 `pnpm next build` 后被自动改写，已 `checkout` 还原，不计入改动。

## §3 P1-1 手机端走查（375 / 390 / 430 × 六项）

走查方式：源码级断点审计（`grid-cols-1 sm:grid-cols-2` 单列断点为 640px，375/390/430 均走单列分支）+ 全仓 `grid-cols-2` 残留扫描。T6 已把 ActionCard 价格双列改为手机端单列，本轮复核六项：

| # | 检查项 | 375 | 390 | 430 | 走查结论 |
|---|---|---|---|---|---|
| 1 | Action 标题换行 | ⚠️标题行无 `min-w-0/break-words` | 同左 | 同左 | 本轮已修复（标题 `flex-1 break-words leading-snug`，emoji `shrink-0`） |
| 2 | 价格换行（关键价格双列挤出） | ✅T6 已单列 | ✅ | ✅ | 维持；本轮追加长数字护栏（`max-w-[60%] break-all text-right`） |
| 3 | 原因列表（为什么/接下来观察） | ⚠️行容器无 `min-w-0`，图标可能挤占文字 | 同左 | 同左 | 本轮已修复（行 `min-w-0`，图标 `shrink-0`，文字 `flex-1 break-words`；条件清单 `truncate` 行补 `min-w-0` 使省略真正生效而不溢出） |
| 4 | 新鲜度行（SourceFreshnessRow 8 徽章） | ✅容器 `flex-wrap`，逐行换行 | ✅ | ✅ | 维持；LiveRadar stale 文案行追加 `min-w-0 break-words` |
| 5 | 历史评分喧宾夺主 | ✅失效后 `opacity-50 grayscale` + 标题改"本轮历史突破评分（仅用于复盘）"，ActionCard 置顶先于分数 | ✅ | ✅ | 维持，无改动（灰化逻辑在 SignalCard/AssetDetail，ActionCard 本身不含评分） |
| 6 | 长数字溢出（浮点伪影/长价格） | ⚠️`shrink-0` 防挤压但超长值无换行护栏；API 原始 `invalidation:0.08957259999999999` 仍带伪影（UI 层 `formatPrice` 已屏蔽，TEST 19 覆盖） | 同左 | 同左 | 本轮已加 `max-w-[60%] break-all text-right`（ActionCard KeyPrice / SignalCard LevelRow / AssetDetail Level）；API 原始值伪影维持现状，只列不修 |

未改动项（只列不修，禁重做视觉）：`HistoryGrid:79` 指标 2 列、`LiveRadar:148` BTC 环境 2 列、`AssetDetail:220` ScoreBox 2 列 / `:322` 资金费率 2 列 / `:352` 条件 2 列、`CandleChart:258` 图例 2 列——均为小尺寸统计瓦片、值为短数字/短词，375px 下无溢出证据，维持现状。

## §4 P1-1 修复清单（量化）

纯 CSS 类名改动，零逻辑、零阈值、零权重：

- `ActionCard.tsx`：标题行/原因行/接下来观察行/warnings/episodeStatus/最后更新 + KeyPrice 长数字护栏，共约 12 处 class 调整。
- `SignalCard.tsx`：`CardHeader` 左列 `min-w-0 flex-1` + `StateBadge` 包 `shrink-0` + 条件清单行 `min-w-0`（2 处）+ `LevelRow` 长数字护栏。
- `AssetDetail.tsx`：`Level` 长数字护栏（1 处）。
- `LiveRadar.tsx`：stale 文案 `min-w-0 break-words`（1 处）。
- 合计：4 文件约 17 处 class 级改动，无新增文件、无函数签名变化、无单测变化（单测仍 97 项，CSS 不进单测口径）。

## §5 P1-2 方案A落字

- `AGENTS.md:9` 关键边界追加：**"方案A（冻结）：研究指标（误报率/Precision/Recall/FPR/Success 率）仅离线研究用，不进入 ActionCard/实时信号/报警，不包装成胜率；ActionCard 只输出当前行动+证据，不输出任何概率化收益表述。"**
- `AGENTS.md:86` 用户偏好追加同口径一句（"不入 ActionCard/报警、不包装成胜率"）。
- `src/app/methodology/page.tsx` `DISCLOSURES` 新增一条（方案A冻结：研究指标仅离线研究用，不进入 ActionCard、实时信号与任何报警/通知，不包装成胜率）。
- 全仓 grep `Audio|Notification|beep|蜂鸣|报警声`（沿用 T6 禁令口径）——本轮未新增任何提醒/报警/声音/通知功能（仅 DISCLOSURES 文案出现"报警/通知"二字作为禁用声明，无功能代码）。T6 实测零命中，本轮新增仅文案+CSS。
- 量化：2 文件 3 处文案追加，零逻辑改动。

## §6 P1-3 证据模板

- 新建 `LIVE_CASE_EVIDENCE_TEMPLATE.md`（1 文件，约 90 行）：Input（抓取时间/价格+candle/funding 时间戳/env/freshness）+ Output 五件套（①当前行动 ②关键价格 ③为什么 ④接下来观察 ⑤新鲜度/数据状态，PEPE/DOGE 各一份）+ 截图清单（只证当时）+ **禁旧截图当现状**铁律 + 四态判定勾选（结论仅 PASS_CANDIDATE/PARTIAL/BLOCKED）。

## §7 阈值/权重/M5 零改动举证

- `git diff HEAD -- src/lib/config.ts src/lib/v2/backtest.ts src/lib/indicators.ts src/lib/state-machine.ts`：空（零 diff）。
- `DEFAULT_V2_THRESHOLDS` / `DEFAULT_V2_WEIGHTS` 数值零改动；M1–M4/M5 表述零改动（方法论页仍为"M1–M4 未证明增量，M5 候选待 holdout"）。
- 本轮 P1 改动文件：4 个 CSS 类调整 + 2 个文案追加 + 1 个模板新增——均不触阈值/权重/回测。**量化零改动：量化参数改动 0 行。**

## §8 测试 / 类型 / Lint / 构建计数（本轮实测，含 P1 改动口径）

| 项 | 命令 | 结果 |
|---|---|---|
| 单测 | `pnpm test` | **97/97 通过，0 失败**（duration ~218ms；与 T6 一致，P1 CSS/文案不进单测口径） |
| 类型 | `pnpm ts-check` | **0 错误**（EXIT 0） |
| Lint | `pnpm lint:build` | **0 告警**（EXIT 0） |
| 生产构建 | `pnpm next build`（Next 16.1.1 Turbopack） | **成功**（EXIT 0）；路由 16 项：`/` `/api/history` `/api/history/[id]` `/api/market/{candles,funding,health,overview}` `/api/similarity` `/api/similarity/current` `/asset/[coin]`（pepe/doge SSG）`/history` `/history/[id]` `/methodology` `/robots.txt` `/similarity` `/_not-found` |

## §9 生产 URL 核验（curl 实测，2026-09-08 ~16:45 UTC+8）

基址 `https://pepe-doge-breakout-radar.vercel.app`：

| 对象 | 实测 | 判定 |
|---|---|---|
| 首页 `/` | 200，60,047B，~1.8s | live |
| `/api/market/overview` | 200，`{ok:true,status:live}`，`fundingProvider:binance`，BTC 78486.1；**无 `freshness`/`fundingTs` 字段** | live；部署内容=HEAD（P0+P1 未部署铁证） |
| `/api/market/candles?coin=PEPE&bar=4H&limit=2` | 200 | live |
| `/api/market/funding?coin=DOGE` | 200 | live |
| `/api/market/health` | 200，`summary:{okx:ok,binance:ok,funding:ok}`，`env:{vercel:production,hnd1,node v24.18.0,serverTimeUtc 2026-09-08T08:45:46Z}` | live 全绿 |
| `/api/history` | 200 | live（count 21，纯本地） |
| `/api/similarity/current?coin=PEPE` | 200 `{ok:true,status:live}` | live |
| `/methodology` | 200，113,572B | live（与 T6 同量级） |
| `/asset/pepe` | 200，109,628B | live（与 T6 同量级） |
| 刷新一致性 | `generatedAt:1788857131013`，`lastConfirmedTs` 三币种同值 1788840000000（4H 对齐） | 新鲜 |

## §10 双币当前 Action（生产 live 直出，非 fixture）

- PEPE：🔴 **REJECT 当前淘汰**（`state:INVALIDATED` + `STRUCTURE_VETO`；Setup 80 / Trigger 100 / Follow 55；现价 3.618e-06；summary 按§5 优先级走结构分支）。
- DOGE：🔴 **REJECT 当前淘汰**（`state:INVALIDATED` + `STRUCTURE_VETO`；Setup 50 / Trigger 60 / Follow 35；现价 0.0894）。
- 与 T6（§7）一致：双 REJECT 结构分支；DOGE 与 TEST12 fixture（RETEST_WATCH）/旧截图字面不一致是行情漂移所致，映射符合代码，不视为回归；复验禁拿旧截图断言现状（见模板§3）。

## §11 freshness / 数据状态

- 生产 payload 无 `freshness`/`fundingTs` → 生产仍跑 HEAD 口径（`dataStatus!=='ok'` 即 DATA_BLOCKED + 非 live 回退），T6 P0 三态 + 本轮 P1 新鲜度文案行均**仅本地、未部署**。
- 本次生产全 live：stale/unavailable/degraded 分支代码级有据、生产本次未触发（预期内）。

## §12 四态判定（CODE_COMPLETE / LOCAL_VALIDATED 与 PRODUCTION_DEPLOYED 区分）

| 判定项 | 结论 | 依据 |
|---|---|---|
| CODE_COMPLETE | 是 | P1-1/P1-2/P1-3 均有代码/文案/模板证据；验证全绿（§8） |
| LOCAL_VALIDATED | 是 | test 97/97 + ts-check 0 错误 + eslint 0 告警 + next build 成功，均在含 P1 改动的 workdir 实测 |
| PRODUCTION_DEPLOYED（P1 内容） | **否——新代码仅本地，未部署** | 生产无 `freshness`/`fundingTs`，方法论/AGENTS 为旧文案；生产内容 = HEAD e55b0a6 |
| PRODUCTION_DEPLOYED（HEAD 内容） | 是（高置信推断） | serverTime（16:45+08）晚于 HEAD（12:25+08）；全链路 live；精确 Deployment SHA 需 Vercel 控制台复核 |
| PRODUCTION_DATA_VALIDATED | 是（本次 live 窗口） | §9 全链路 200 + health 全绿 + 双币 Action 可复现 |
| 部署等待 | **部署等用户批** | 未 push、未 deploy；是否 commit/push（含 T6 P0 + 本轮 P1）需用户批准，非本任务权限 |

## §13 风险与下一步（只列不修）

1. T6 P0 脏改（含 2 处引擎输出行为变化：Risk DATA_UNAVAILABLE 扩大 + staleFields）仍未提交未部署，需所有者先裁决"可靠性诚实化"定性（见交接报告§10.2），再决定 commit+push。
2. 方法论字面冲突（AGENTS 约束 vs 研究层 precision/误报率）——本轮方案A落字已在 AGENTS+方法论页双向钉死"仅离线研究用、不入 ActionCard/报警"，冲突收敛情况需所有者确认。
3. DOGE API 原始 `invalidation` 浮点伪影（UI 已屏蔽，API 原文如此）是否在 API 层同样格式化，待裁决。
4. 下一步（非本任务权限）：用户批 commit+push → Vercel 自动部署 → 复验 `freshness` 字段 + P1 文案上线 + 新 holdout 验证 M5（禁污染冻结 Test）。

## §14 结论（三选一）

### 结论：**PARTIAL**

理由：

1. P1-1 走查完成、明显问题已做响应式修复（纯 CSS，17 处，零逻辑）；P1-2 方案A已在 AGENTS.md（2 处）与方法论页（1 条 disclosures）落字；P1-3 模板已新建；验证四项全绿（97/97、0 错误、0 告警、build 成功）；生产 live 全链路有据——PASS_CANDIDATE 的必要条件已满足。
2. 但工作树含 T6 P0 未提交行为变化（Risk 门控收紧 + staleFields，需所有者裁决后才能 commit/push/部署），且 P1 新代码明确未部署（CODE_COMPLETE/LOCAL_VALIDATED 与 PRODUCTION_DEPLOYED 已区分，部署等用户批），故不定 PASS_CANDIDATE、亦非 BLOCKED。
3. 量化改动明写：量化参数（阈值/权重/M5/算法）改动 **0 行**；本轮 P1 改动 = CSS 类约 17 处 + 文案 3 处 + 新增模板 1 文件。

### worker_done 回告字段

- 报告路径：`pepe-doge-breakout-radar-deepseek-v4-pro/PRE_ALERT_RELIABILITY_REVIEW.md`（本文件）+ 模板 `LIVE_CASE_EVIDENCE_TEMPLATE.md`
- HEAD：`e55b0a6ad0955e3d7c24d4f1018d75bde3aa07e3`（main；workdir DIRTY，未 commit，未 push）
- status：测试 `97/97 PASS`，`ts-check 0 错误`，`eslint 0 告警`，`next build 成功`（16 路由）
- build 数：`pnpm next build` EXIT 0（Next 16.1.1 Turbopack）
- 生产状态：`https://pepe-doge-breakout-radar.vercel.app` 全 live（overview/candles/funding/health/history/similarity/methodology/asset 均 200，health 全绿 hnd1）；生产内容=HEAD，P0+P1 新代码仅本地未部署，部署等用户批
- 双币 Action：PEPE 🔴REJECT（INVALIDATED+STRUCTURE_VETO，80/100/55）/ DOGE 🔴REJECT（INVALIDATED+STRUCTURE_VETO，50/60/35）
- freshness：生产 payload 无 freshness/fundingTs（未部署铁证）；本地三态+新鲜度行验证通过（freshness.test 24 项含在 97 内）
- 手机端结果：375/390/430 走查完成；价格双列 T6 已单列维持；本轮修复标题换行/原因列表/长数字护栏/新鲜度文案换行（纯 CSS，不重做视觉）；历史评分灰化维持
- 量化是否改动：否——阈值/权重/M5/算法 0 行改动（`config/indicators/state-machine/backtest` 零 diff）
