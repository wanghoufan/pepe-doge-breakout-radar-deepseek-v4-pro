# CURRENT_STAGE_REVIEW_HANDOFF（冻结评审交接）

> 性质：业务仓内只读梳理 + 冻结报告；唯一写操作是本文件，不改业务代码/依赖/配置、不 commit。
> 绑定：task_7ff6bf05da17 / dispatch ctx_354c6448f1d4
> 生成时间（UTC+8）：2026-09-08 ~16:30（UTC 08:25 前后实测）
> 禁令遵守：未新增任何提醒/报警/声音/通知功能（src 全仓 grep Audio|Notification|beep|蜂鸣|报警声 零命中）；
> 未调任何策略权重/阈值（`config.ts` workdir vs HEAD 零 diff）；未改依赖/密钥；未 commit。

---

## §1 冻结：repo 路径 / 分支 / HEAD / 近 8 commit / git status 分类 / 生产部署

- repo 路径：`/Users/zzymima0000/Developer/coding/1.Active/ing 丨0907山寨滚仓网站-deepseek-v4-pro/pepe-doge-breakout-radar-deepseek-v4-pro`
- 分支：`main`（与 `origin/main` 同步；HEAD 即远端最新，无待 push 证据需复核 `git status -sb`，见下）
- HEAD：`e55b0a6ad0955e3d7c24d4f1018d75bde3aa07e3`
- remote：`https://github.com/wanghoufan/pepe-doge-breakout-radar-deepseek-v4-pro.git`（fetch/push 同址）
- 近 8 commit（`git log --oneline -8`，ISO 时间）：

```
e55b0a6 2026-09-08 12:25:53 +0800 docs(radar): 洁癖对齐(删analysis.ts幽灵条目/补ActionCard组件/candles-funding改503诊断/测试数73)
c831f59 2026-09-08 12:17:02 +0800 docs(radar): 存档4散文件 + AGENTS测试数38→73(实测) + 补.preview门牌
e8b10cb 2026-09-08 12:16:46 +0800 merge(main): 并入 f586d4a 文档同步V2+清理V1残留（用户已确认）
8c0d3ac 2026-09-08 10:21:09 +0800 docs(radar): 新增项目完整进展总览 PROJECT_PROGRESS.md
74b4ede 2026-09-08 10:17:56 +0800 fix(radar): 独立审查 + QA 整改（REJECT 文案分支/术语统一/格式化统一/清理）
4d7c724 2026-09-08 10:02:06 +0800 fix(radar): Action Card 真机验证修复 + 真实截图
505ef64 2026-09-08 09:51:55 +0800 feat(radar): Action Card 当前行动卡（UX 决策解释层）
dad7e77 2026-09-08 08:54:33 +0800 docs(radar): V2 整改评估报告（冻结后评估产出）
```

- `git status` 分类（本轮实测，与上一版报告“干净”结论有变化，特此冻结记录）：
  - staged（`git diff --cached --stat`）：空，0 文件
  - unstaged tracked modified（`git diff --stat`）：**9 文件**（见下表，P0 可靠性整改，未提交）
  - untracked（`??`）：**2 文件** —— `CURRENT_STAGE_REVIEW_HANDOFF.md`（本文件，前版遗留未 tracked）、`src/lib/freshness.ts`、`src/lib/freshness.test.ts`（实为 2 个新增源码文件 + 本文件；`git status --porcelain` 输出 `?? CURRENT_STAGE_REVIEW_HANDOFF.md / ?? src/lib/freshness.test.ts / ?? src/lib/freshness.ts`）
  - 结论：工作树 **DIRTY**。上一版报告（~13:00）记 clean；本轮（~16:30）有人（非本任务，本任务只读）新增了 P0 新鲜度整改且未提交。评审必须以“HEAD=e55b0a6 + workdir 脏改”双口径阅读，不可只看 HEAD。

| workdir 改动文件 | 行数变化 | 一句话定性（详见§10） |
|---|---|---|
| `src/lib/freshness.ts`（新增 122 行） | +122 | 三态新鲜度纯函数：ok/stale/unavailable + 8h/24h 阈值 |
| `src/lib/freshness.test.ts`（新增 278 行） | +278 | 24 项 P0 演练单测 |
| `src/lib/v2/engine.ts` | +43/-~10 | Risk 门控收紧 + staleFields 填充（行为变化，有单测） |
| `src/lib/market-service.ts` | +24 | overview 加性字段 freshness/fundingTs（不改 live 判定） |
| `src/app/api/market/overview/route.ts` | +2 | 透传 freshness/fundingTs |
| `src/components/market/DataStatus.tsx` | +53 | 新增 SourceFreshnessRow（纯展示） |
| `src/components/market/LiveRadar.tsx` | +25/-~4 | 三态门控 + 新鲜度行 + 向 SignalCard 传 dataStatus |
| `src/components/market/AssetDetail.tsx` | +29/-~8 | forcedStatus 改走服务端 freshness + 新鲜度行 + 移动端单列 |
| `src/components/market/SignalCard.tsx` | +22/-~8 | staleFields 文案 + 移动端单列 |
| `src/components/market/ActionCard.tsx` | +10/-~6 | 移动端单列 + 防溢出（纯 CSS） |
| `src/components/market/HistoryGrid.tsx` | +1/-1 | flex-wrap 防溢出（纯 CSS） |

- 生产部署 commit 与 URL：
  - 生产 URL：`https://pepe-doge-breakout-radar.vercel.app`（Vercel 项目 `pepe-doge-breakout-radar`，地域 `hnd1` 东京；`vercel.json` 为 `framework: nextjs` / `installCommand: pnpm install --no-frozen-lockfile` / `buildCommand: pnpm next build`；push 到 `main` 自动触发生产部署）
  - 本轮铁证：生产 `/api/market/overview` 实测 **无 `freshness`/`fundingTs` 字段**（§12），而 workdir 已有 → **生产部署内容 = HEAD e55b0a6（不含 workdir P0 脏改）**。生产 serverTime `2026-09-08T08:25:05Z`（= 北京时间 16:25）晚于 HEAD 时间，印证生产已含 e55b0a6。如需精确 Deployment SHA 需 Vercel 控制台复核，不虚构。
  - 最早生产可查记录：`3d9e048 fix(market): OKX 实时行情接通 + 独立降级 + 真实诊断`（`052b743 docs(handoff)` 写明 Vercel 已绑定 GitHub 并完成生产部署，health 全绿）。

---

## §2 数据实时行情链路（逐项定级）

定级口径：`IMPLEMENTED`=代码+测试+生产 curl 三方有据；`PARTIAL`=部分链路缺口但有明确降级；`NOT_IMPLEMENTED`=无代码。

| 功能 | 定级 | 证据（源码路径 + 行为） |
|---|---|---|
| PEPE 行情（K线+最新价） | IMPLEMENTED | `src/lib/market-client.ts:getOkxCandles/getOkxTickers`（OKX 双域名回退，8s 超时，60s 内存 TTL，去重，`confirmed` 收盘位解析）；`src/lib/market-service.ts:getMarketOverview` 并行拉三币种；生产 `candles?coin=PEPE&bar=4H` 200 `source:live/provider:okx`，`overview.pepe` 非空 |
| DOGE 行情 | IMPLEMENTED | 同上；生产 `overview.doge` 非空，`episodeId:EP-DOGE-002` |
| BTC 行情 + 环境参照 | IMPLEMENTED | `src/lib/v2/engine.ts:computeBtcEnvironment`（7 日收益/24h 最大回撤/EMA100/硬破位/趋势）+ `evaluateEnvironment`（ALLOW/CAUTION/BLOCK）；生产 `btc.price:78349.9`，`fundingProvider:binance` |
| Funding 资金费率 | IMPLEMENTED | `market-client.ts:getFunding`：Binance 优先（`1000PEPEUSDT`/`DOGEUSDT`），失败切 OKX 实时（非快照），双败才 `funding_unavailable`；生产 `funding?coin=DOGE` 200 `provider:binance/degraded:false` |
| 手动刷新 | IMPLEMENTED | `src/hooks/use-api.ts:refresh`（nonce 触发 + AbortController 清理）；`LiveRadar.tsx` 刷新按钮；`AssetDetail.tsx:refreshAll`（candles+funding+overview 三刷） |
| 4H 收盘判定 | IMPLEMENTED | `src/lib/time.ts:floorTo4H/isCandleClosed`；`market-client.ts` 仅 `confirmed==1` 进 `confirmedCandles`，最新 `confirm==0` 单列 `intradayCandle`；判定突破只吃已收盘；UI `SignalCard.tsx`“判定口径·4H已收盘K线”，盘中标注“不构成突破确认” |
| stale（过期/非最新） | IMPLEMENTED（workdir）/ PARTIAL（HEAD/生产） | HEAD 口径（生产仍在用）：Action 层 `src/lib/action.ts:235` `dataStatus!=='ok'` 即 `DATA_BLOCKED`，`AssetDetail.tsx`（HEAD 版）非 live 硬编码 `forcedStatus:'stale'`；但 `market-service.ts`（HEAD）`status` 仅 live/unavailable 两态，无 stale 字面态。workdir P0 已补齐：`freshness.ts:deriveOverviewFreshness` 三态 + `assessFeedFreshness`（8h）+ 服务端透传 + UI 三态门控，`freshness.test.ts` P0-4b 演练覆盖 → workdir 口径记 IMPLEMENTED |
| fallback（降级，不拿快照冒充） | IMPLEMENTED | candles/funding 失败 503 + 真实诊断；overview 无网 `{status:'unavailable'}+summary+errors`；funding Binance→OKX 实时兜底；OKX 多域名回退；历史/相似纯本地恒可用；UI 明确“未使用任何快照冒充”+ `DiagBox` |
| health 连通性诊断 | IMPLEMENTED | `src/app/api/market/health/route.ts`：10 probes；生产实测 `summary:{okx:ok,binance:ok,funding:ok}` 全绿，`env:{runtime:vercel:production,region:hnd1,node:v24.18.0}` |

---

## §3 V2 核心模块（逐项定级）

| 模块 | 定级 | 源码路径 + 说明 |
|---|---|---|
| RollingBreakout（42 根回看） | IMPLEMENTED | `src/lib/breakout.ts:getRollingHigh/detectBreakoutAt/detectBreakout/detectAllBreakouts`（实时/历史/回测共用；v2.test TEST 10/13 一致性断言） |
| IndependentEpisode（去重） | IMPLEMENTED | `src/lib/v2/episode.ts`：Hybrid-D，290 raw→116 独立；TEST 1/2/4（连续创新高只产一 Episode / reset 可产新事件 / P10 聚合） |
| Reset 语义 | IMPLEMENTED | 同上 TEST 2；`episode.ts` Builder 顺序判定，无未来信息（TEST 3） |
| Env（BTC 环境闸门） | IMPLEMENTED | `engine.ts:computeBtcEnvironment/evaluateEnvironment`（ALLOW/CAUTION/BLOCK）；TEST 9（BTC 硬破位→BTC_VETO+MARKET_BLOCKED） |
| Setup 层 | IMPLEMENTED | `engine.ts` Setup 打分（突破前特征，实时/回测同一函数）；普通窗口 768（PEPE 5/DOGE 7 口径见 AGENTS） |
| Trigger 层 | IMPLEMENTED | `engine.ts` Trigger 打分；`backtest.ts:CANDIDATE_RULES` |
| FollowThrough 层 | IMPLEMENTED | `engine.ts` + `action.ts:describeFollowThrough`（HEALTHY≥60 display-only）；缺失一律 PENDING 不判低分（TEST 7） |
| EntryHeat（原 Risk） | IMPLEMENTED | `engine.ts` Risk 层 + `action.ts:ENTRY_HEAT_*`（高≥70/中≥40 display-only）；**workdir P0-2 收紧**：`resolveRiskLayer` 缺 funding/任一条件 unknown/funding stale 一律 DATA_UNAVAILABLE（见§10） |
| HardVeto | IMPLEMENTED | `engine.ts` HardVeto 层（DATA_VETO/BTC_VETO/STRUCTURE_VETO/NONE）；TEST 8（缺数据→DATA_VETO 不当 0 分） |
| Outcome（多窗口 MFE/MAE） | IMPLEMENTED | `src/lib/v2/outcomes.ts` + `src/lib/mfe-mae.ts`（24/48/72h/7D，相对 breakoutClose，窗口不含突破K线；TEST 6/7） |
| NormalWindows（普通对照） | IMPLEMENTED | `src/lib/v2/normal-windows.ts`（768 窗口；TEST 8/9/10：全量生成/不含 episode start/误报率可算） |
| WalkForward（样本外） | IMPLEMENTED | `src/lib/v2/backtest.ts:walkForwardBacktest`（TEST 7 train 早于 test；TEST 11 不跨 fold；TEST 12 参数冻结；M1–M4 ROC-AUC~0.5 未证增量） |
| IncrementalEval（增量评估） | IMPLEMENTED | `src/lib/v2/` 增量信号函数 + 特征行构建冒烟测试（本轮 `pnpm test` 末项通过）；`INCREMENTAL_MODEL_REPORT.md` |

---

## §4 ActionCard 实际状态及源码路径

- 状态：**IMPLEMENTED**（决策解释层，非量化策略；纯函数映射 + render，签名中无 outcome 字段）。
- 源码路径：
  - 判定：`src/lib/action.ts`（`deriveActionState` + `actionInputFromSignal` + `describeFollowThrough` + `ACTION_META/ENTRY_HEAT_*/*_COPY`）
  - 展示：`src/components/market/ActionCard.tsx`（Level1 行动 / Level2 关键价格 / Level3 为什么+接下来观察；组件内无策略 if/else；本轮 workdir 仅 CSS 单列防溢出）
  - 装配：`src/components/market/SignalCard.tsx`（ActionCard 置顶 + 历史评分灰化）、`src/components/market/AssetDetail.tsx`（同上 + stale 映射；workdir 改走服务端 freshness）、`src/app/methodology/page.tsx`（Action 7 态 + 优先级说明）
  - 测试：`src/lib/action.test.ts`（19 项全绿，见§6）
  - 报告：`ACTION_CARD_REPORT.md`
- 7 状态（6 主 + 1 兜底）：`REJECT🔴 / WATCH🟡 / BREAKOUT_TRACK🟢 / RETEST_WATCH🔵 / OVERHEATED🟠 / DATA_BLOCKED⚫ / NO_ACTION⚪`（`action.ts:22-30/122-130`）。

---

## §5 ActionPriority（以代码为准）

`src/lib/action.ts:deriveActionState:205-476` 实测顺序（workdir 未动本函数，HEAD 与 workdir 一致）：

```
1) DATA_BLOCKED：dataStatus!=='ok' → 停出候选，不沿用旧信号（:235）
2) REJECT：hardVeto!=NONE 或 env==BLOCK 或 state in {FAILED_BREAKOUT, INVALIDATED, MARKET_BLOCKED}（:263）
   2a DATA_VETO → 数据分支（不断言跌破）（:266-282）
   2b 环境BLOCK（无失效态）→ 环境分支（:285-305，BTC_VETO 同走此分支并点名）
   2c 结构性否决/失效 → 跌破失效位分支（仅此处可用跌破表述）（:306-337）
3) OVERHEATED：结构有效 + (Heat高 或 距突破位≥chasePct 25%)（:343-374）
4) RETEST_WATCH：state==RETESTING 且 structureValid（:377-400）
5) BREAKOUT_TRACK：state in {BREAKOUT_CONFIRMED, FOLLOW_THROUGH_PENDING, HEALTHY_BREAKOUT}（:403-432）
6) WATCH：state in {NEAR_BREAKOUT, BUILDING_SETUP}（Setup只进观察）（:435-461）
7) NO_ACTION：兜底（:464-476）
```

方法论页同口径复述（`methodology/page.tsx:190-193`）：“数据不足 ＞ 硬否决 ＞ 环境BLOCK ＞ 突破失败/结构失效 ＞ 过热 ＞ 回踩观察 ＞ 突破跟踪 ＞ 接近阻力/蓄势观察 ＞ 暂无行动”。

---

## §6 CaseA / CaseB 验证（以代码为准）

### CaseA：Setup100+Trigger100+STRUCTURE_VETO 必 REJECT（高分不覆盖 Veto）

- 位置：`src/lib/action.test.ts:TEST 1`（`STRUCTURE_VETO + Setup100/Trigger100 + Heat0 → REJECT`）+ `TEST 11 PEPE 当前 Case` + `TEST 13`。
- 本轮实测：`node --import tsx --test src/lib/action.test.ts` → **TEST 1 / TEST 11 / TEST 13 全部 ✔**（19/19 通过）。
- 语义：`code==REJECT`，`title==当前淘汰`，`history.historicalOnly==true`，`warnings` 含“历史突破评分”，`nextConditions` 含“不沿用旧 episode”，且无 8 类禁用语（买入/开仓/胜率等）。
- 结论：**CaseA 通过**。`action.ts:263` 分支优先于一切分数；workdir 未动本函数，结论对 HEAD 与 workdir 同成立。

### CaseB：RETESTING+StructureValid+VetoNONE 得 RETEST_WATCH

- 位置：`action.test.ts:TEST 8`（`RETESTING + 结构有效 + 无否决 → RETEST_WATCH`）+ `TEST 12 DOGE 当前 Case` + `TEST 15`（映射不依赖未来 Outcome）。
- 本轮实测：**TEST 8 / TEST 12 / TEST 15 全部 ✔**（fixture 口径：`RETESTING + breakoutConfirmed true + heldAbove true + NONE + ALLOW` → `code==RETEST_WATCH`，`reasons≥4×ok`，同输入双跑 deepEqual 确定性通过）。
- 结论：**CaseB 通过（fixture 回归口径）**。注意 live DOGE 已两次漂移（§7），不是 CaseB 被否定，而是 live 输入不再满足 RETEST 前提（`heldAbove false` → 先 FAILED_BREAKOUT → 今 INVALIDATED）。

---

## §7 PEPE / DOGE 当前 Case（生产 live 直出，非 fixture）

抓取时间：2026-09-08 ~16:25（UTC+8），`GET /api/market/overview` `status:live`，`summary:"环境中性：BTC 区间震荡；PEPE 结构失效，DOGE 结构失效；BTC 24h 回撤 -2.20%"`。
`generatedAt:1788855872847`，`fundingProvider:binance`，`prices:{PEPE 3.593e-06, DOGE 0.08905, BTC 78349.9}`，
`lastConfirmedTs:{PEPE/DOGE/BTC 1788840000000}`。**生产 payload 无 `freshness`/`fundingTs`**（部署=HEAD 证据）。

- PEPE（live）：
  - Symbol/Price：PEPE / 3.593e-06（现价 ts 1788855872669）
  - Env/Episode/Action：`env:ALLOW` / `EP-PEPE-001`（trigger 7/7，isEpisodeStart false）/ 按§5 优先级命中第 2 类 → **🔴 REJECT 当前淘汰**（结构分支，历史评分灰化）
  - Setup/Trigger/FollowThrough/EntryHeat：`setup:80/COMPUTED` / `trigger:100/COMPUTED` / `follow:55/COMPUTED` / `risk:0/COMPUTED`（EntryHeat 低，但 Veto 优先，低分不救）
  - Veto：`STRUCTURE_VETO`（币种跌破关键结构失效位），`state:INVALIDATED`
  - 突破位/失效位/压力：突破位 `4.097e-06`（收盘 4.121e-06，超越幅度 +0.59%，量比 2.73x）/ 失效位 `3.64626e-06` / 当前下一压力 `3.879e-06`（EMA20 3.5958e-06）
  - Age：`hoursSinceBreakout:416`（104 根 4H；上一版 412h，自然流逝 +4h）
  - Summary/Reasons/Next（按代码推导）：summary“当前价格已经跌破结构失效位，本轮突破结构失效”；reasons 含 BTC 环境允许 + STRUCTURE_VETO 已触发 + 本轮结构已失效；next“系统识别到新的 Independent Breakout Episode → 重新进入观察或跟踪（不沿用旧 episode）”
- DOGE（live，与 TEST12 fixture、上一版报告均已漂移，特此冻结记录）：
  - Symbol/Price：DOGE / 0.08905（现价 ts 1788855872268）
  - Env/Episode/Action：`env:ALLOW` / `EP-DOGE-002`（1/1，isEpisodeStart true）/ 命中第 2 类 → **🔴 REJECT 当前淘汰**（结构分支；不是 RETEST_WATCH）
  - Setup/Trigger/FollowThrough/EntryHeat：`setup:50/COMPUTED` / `trigger:60/COMPUTED` / `follow:35/COMPUTED` / `risk:0/COMPUTED`
  - Veto：`STRUCTURE_VETO`（币种跌破关键结构失效位），`state:INVALIDATED`（上一版为 `FAILED_BREAKOUT + NONE`；行情继续走坏，veto 已触发）
  - 突破位/失效位/压力：突破位 `0.08995`（收盘 0.09071，超越幅度 +0.84%，量比 6.54x）/ 失效位 `0.0895726`（**API 原始值 `0.08957259999999999`，浮点伪影经 `formatPrice` 在 UI 已屏蔽，TEST 19 覆盖；API 层原文如此，冻结记录**）/ 当前下一压力 `0.09529`（EMA20 0.088941）
  - Age：`hoursSinceBreakout:60`（15 根 4H；上一版 56h）
  - Summary/Reasons/Next：同 PEPE 结构分支；`episodeStatus`“本轮 Episode 已失效，等待新的蓄势与 Independent Breakout Episode”
- 漂移时间线（冻结备查）：TEST12 fixture（RETESTING→RETEST_WATCH）→ 上一版 live（FAILED_BREAKOUT+NONE→REJECT）→ 本轮 live（INVALIDATED+STRUCTURE_VETO→REJECT）。映射始终符合§5，输出变化来自输入变化，不是回归。复验时勿用旧截图断言 DOGE 必为蓝卡。

---

## §8 UI 语义整改确认（以代码为准，HEAD 已落地；workdir 只加了新鲜度行与移动端单列）

| 整改项 | 确认 | 源码位置 |
|---|---|---|
| Risk → Entry Heat·追高/过热（值/100·低中高/未知 + tooltip 非全部风险） | 已改 | `action.ts:132-140 ENTRY_HEAT_COPY`，`SignalCard.tsx:113/203-220 EntryHeatLine`，`AssetDetail.tsx:224` |
| 突破位 → 本轮突破位 | 已改 | `ActionCard.tsx:38`，`SignalCard.tsx:119`，`AssetDetail.tsx:232` |
| rolling阻力 → 当前下一压力 | 已改 | `SignalCard.tsx:138`，`AssetDetail.tsx:230`，`types.ts:KeyLevels.resistance` 注释 |
| 失效观察位 → 结构失效位 | 已改 | `ActionCard.tsx:39`，`SignalCard.tsx:139`，`AssetDetail.tsx:231` |
| 突破距离 → 突破当根超越幅度（与当前距突破位禁止混用） | 已改 | `breakout.ts` 注释改名，`ActionCard.tsx:41-57` 双指标分开展示（当前距突破位 / 突破当根超越幅度），`SignalCard.tsx:121` |
| 失效后 Setup/Trigger/Follow 灰化 + “本轮历史突破评分，仅用于复盘” | 已改 | `SignalCard.tsx:100-103`（opacity+grayscale），`AssetDetail.tsx` 同口径，`action.ts:history.historicalOnly`；TEST 13 覆盖 |
| Trigger tooltip 不代表未来收益概率 | 已改 | `action.ts:142-144 TRIGGER_COPY`，`SignalCard.tsx:105` |
| Setup tooltip 含 41%/30% 误报 | 已改 | `action.ts:146-149 SETUP_COPY`，`methodology/page.tsx:34/139` |
| Follow-through 状态优先（HEALTHY·值/PENDING），缺失不显0分 | 已改 | `action.ts:155-180 describeFollowThrough`，`SignalCard.tsx:106-112`；TEST 7 覆盖 |
| 条件清单 rolling阻力 → 本轮突破位 | 已改 | `engine.ts` label（BUG-001） |
| 方法论导语 风险分 → Entry Heat | 已改 | `methodology/page.tsx:81-82`（BUG-002） |
| 价格文案统一 formatPrice（修浮点伪影） | 已改（UI 层） | `action.ts` 删 `fmtNum` 走 `formatPrice`，`action.test.ts:TEST 19`；但 production API 原始 `invalidation:0.08957259999999999` 仍带伪影（§7），UI 展示已屏蔽 |
| 硬编码 hex → token | 已改 | `SignalCard.tsx`、`AssetDetail.tsx` 用 `--btc/--radar/--bear/--warn/--bull` |
| Action 先于分数（ActionCard 置顶，历史评分灰化） | 已改 | `SignalCard.tsx` ActionCard 置顶 + `historicalOnly` 灰化分支 |
| 失效 Episode 降级展示 | 已改 | REJECT 结构分支 + `episodeStatus`“等待新的 Episode”+ 灰化（TEST 11/13） |
| workdir 新增：来源新鲜度行（ok/stale/unavailable + 最后更新 + 相对时间，纯展示） | 新增未部署 | `DataStatus.tsx:SourceFreshnessRow` + `LiveRadar.tsx`/`AssetDetail.tsx` 装配；阈值复用 `freshness.ts` 单一来源 |
| workdir 新增：staleFields 文案（部分数据已过期：funding） | 新增未部署 | `SignalCard.tsx` degraded 分支；`engine.ts` 填充 |

---

## §9 Methodology 一致性：冲突只列不修（本轮未动任何措辞）

以下为冻结记录，供所有者裁决，本任务未改：

1. AGENTS.md 约束（`AGENTS.md:9`）：“不输出面向交易决策的胜率、准确率、假突破概率” vs 方法论页 + UI 实际输出 `Precision/Recall/FPR/Success Rate/MFE/MAE`（`methodology/page.tsx:137` 声明“只反映样本外真实表现，不构成收益承诺”）+ `BUILDING 41%/NEAR 30%` 误报率（`:34/139`）+ 普通窗口 768。AGENTS 现行文本已澄清为“回测指标仅作研究诚实性证据在方法论页呈现 + 普通窗口已纳入”，审查要求二选一：A.约束澄清为仅限实时信号层（研究层允许口径标注指标）；B.从 UI 文案移除误报率数字。裁决前维持现状，报告指标未进任何信号 UI（`ACTION_CARD_REPORT.md §11` 同口径）。**本轮复核：`methodology/page.tsx:94` 仍写 `M1–M4 ROC-AUC~0.5 未证明增量，M5 候选待 holdout` + `:136`“不是投资建议…不输出建议开仓/买入/胜率”，与 AGENTS 字面张力仍在，未收敛。**
2. M1–M4/M5 表述：方法论页 `M1–M4 未证明增量，M5 候选待 holdout`（`:94/138`），`ACTION_CARD_REPORT §8/10` 同口径 + `OVERHEATED/WEAK display-only 未经回测`。与“不做预测宣称”一致，无新增冲突，仅冻结。
3. QA INFO-002（`==` 边界）/ INFO-003（`heldAbove=null` 处理）维持现状，含义见 QA 清单备注（`ACTION_CARD_REPORT §11`）。
4. 新增观察（只列不修）：DOGE API `invalidation` 原始浮点伪影（§7）与 TEST 19“无浮点伪影”结论的口径差——TEST 19 覆盖的是 UI 展示层（`formatPrice`），API 原始值不在其范围内；是否需要在 API 层同样格式化，供所有者裁决。

---

## §10 ActionCard 阶段是否误改底层量化：git 举证

### 10.1 取证区间一：`505ef64^..HEAD`（ActionCard 三连提交，全含）——结论：只改解释层/UI，未改策略

- `git show --stat 505ef64`：新增 `action.ts/action.test.ts/ActionCard.tsx/ACTION_CARD_REPORT.md` + 改 `SignalCard/AssetDetail/methodology`，无 `engine/config/breakout/indicators/state-machine`。
- `git show --stat 4d7c724`：仅 `action.ts fmtNum` 展示修复 + 两张截图 + 报告 §9，无策略文件。
- `git show --stat 74b4ede`：19 文件，策略侧仅 5 处非数值改动（`git diff 505ef64^..HEAD -- engine/config/breakout/indicators/state-machine/market-service/types/backtest/episode`）：
  - `breakout.ts`：注释 `突破距离` → `突破当根超越幅度`（1 行注释）。
  - `config.ts`：`STATE_META.BREAKOUT_CONFIRMED.description` 文案改名；`DEFAULT_V2_THRESHOLDS` 与 `DEFAULT_V2_WEIGHTS` 数值零改动。
  - `engine.ts`：`closeBreakout label` 改名（1 行）+ risk funding 缺失时 `DATA_UNAVAILABLE`（分值口径不变，Entry Heat 显示“未知”而非“低”，诚实化非调参）。
  - `episode.ts`：删两处死赋值，行为不变。`backtest.ts`：加 3 行注释。`market-service.ts`/`types.ts`：删死类型 `'partial'` + 注释改名。
  - `indicators.ts` / `state-machine.ts` / 阈值权重表：零 diff。
- **明写结论（区间一）：ActionCard 阶段只改了解释层/UI，未改任何量化阈值/权重/算法；唯一展示分档新增（Heat 高≥70/中≥40、Follow HEALTHY≥60）为 display-only，不参与交易判定与回测。**

### 10.2 取证区间二：`HEAD..workdir`（本轮发现的未提交 P0 脏改）——结论：有行为变化，但无阈值/权重改动

`git diff HEAD --stat` 9 文件 + 新增 `freshness.ts/freshness.test.ts`（§1 表）。逐项列文件/Old/New/Reason/Impact：

| 文件 | Old | New | Reason（代码注释原话） | Impact（诚实评估） |
|---|---|---|---|---|
| `src/lib/freshness.ts`（新增） | 无 | 三态纯函数 + `CANDLE_STALE_AFTER_MS=8h` / `FUNDING_STALE_AFTER_MS=24h` | “可靠性 SLA，不是交易阈值/权重/M5，不参与任何评分与回测” | 新增可靠性门控口径；阈值仅用于新鲜度展示与 DATA_BLOCKED，不进评分/回测 |
| `src/lib/v2/engine.ts:resolveRiskLayer`（新增导出） | `fundingAvgPct==null ? DATA_UNAVAILABLE : COMPUTED` | 任一 Risk 条件 unknown、或 funding 缺失/过期（`assessFundingFreshness!==ok`）→ `DATA_UNAVAILABLE`，否则 COMPUTED（分值不变） | “P0-2 缺数据禁示低风险；分值口径不变，仅状态诚实化；不触阈值/权重/M5” | **行为变化**：funding 过期、任一 Risk 条件缺失时，Risk 由 COMPUTED 低分变为 DATA_UNAVAILABLE → EntryHeat 显示“未知”而非“低”。生产当前两币 `risk:0/COMPUTED` 在 P0 口径下是否仍为 COMPUTED 取决于 funding 新鲜度（生产 funding 为 live，预期不变；待部署后复验） |
| `src/lib/v2/engine.ts:staleFields` | `staleFields:[]`，`degraded=missingFields>0` | funding stale 时 `staleFields:['funding']`，`degraded` 含 stale，summary 追加“n 项数据过期” | “P0-1 staleFields 如实填充” | **行为变化**：`dataQuality` 输出新增 stale 维度；UI degraded 文案新增分支。评分/状态机输入未变 |
| `src/lib/market-service.ts` | 无 freshness 概念 | 加性字段 `freshness:FeedFreshness` + `fundingTs`；`status` live/unavailable 判定**未动** | “加性字段，不改变 live/unavailable 判定” | 加性，无判定变化；旧客户端缺字段回退逻辑已在 UI 侧兼容 |
| `src/app/api/market/overview/route.ts` | 不透传 | +`freshness`/`fundingTs` 透传 | 同上 | 加性 |
| `LiveRadar/AssetDetail` 门控 | 非 live 硬编码 `'stale'`（AssetDetail）/ 无门控（LiveRadar） | 优先服务端 `freshness.status`，缺字段回退旧行为 | “P0-1 三态；缺字段时按 live 回退（不改变旧行为）” | 部署后：stale 会触发 DATA_BLOCKED（此前 AssetDetail 非 live 即 stale，LiveRadar 无 stale 概念）；属可靠性收紧，需部署后用§12 复验 |
| `DataStatus:SourceFreshnessRow` | 无 | 8 路 ok/stale/unavailable 徽章纯展示 | “纯展示，无声音报警、无判定逻辑” | 无判定影响；禁令（无声音通知）遵守 |
| CSS 类（ActionCard/SignalCard/AssetDetail/HistoryGrid） | `grid-cols-2` 等 | `grid-cols-1 sm:grid-cols-2` + 防溢出 | “手机端单列防溢出” | 纯展示，无逻辑影响 |
| `config.ts/indicators.ts/state-machine.ts/breakout.ts` | — | **零 diff** | — | **阈值/权重/算法未动** |

- **明写总结论：区间一（已部署）只改解释层；区间二（未提交未部署）含两处引擎输出行为变化（Risk DATA_UNAVAILABLE 扩大 + staleFields），但阈值/权重/算法零改动，且有 24 项新增单测锁定。是否接受区间二为“可靠性诚实化而非调策略”，需所有者裁决；本报告只举证不定性为 PASS。**

---

## §11 测试 / 类型 / Lint / 构建计数（本轮实测，workdir 含 P0 脏改口径）

- `pnpm test`（`node --import tsx --test src/lib/*.test.ts src/lib/v2/*.test.ts`）：**97/97 通过，0 失败**（上一版 73；+24 来自 `freshness.test.ts` P0 演练；含 `action.test.ts` 19 项；duration ~231ms）。
- `pnpm ts-check`（`tsc -p tsconfig.json`）：**0 错误**（EXIT 0）。
- `pnpm lint:build`（`eslint . --quiet`）：**0 告警**（EXIT 0）。
- 生产构建（`pnpm next build`，Next 16.1.1 Turbopack）：**成功**（EXIT 0），路由表：`/` `/_not-found` `/api/history` `/api/history/[id]` `/api/market/candles` `/api/market/funding` `/api/market/health` `/api/market/overview` `/api/similarity` `/api/similarity/current` `/asset/[coin]`（pepe/doge SSG）`/history` `/history/[id]` `/methodology` `/robots.txt` `/similarity`。本地构建写 `.next/`（gitignored，不计入 status；本轮构建后 `git status` 未新增 tracked 改动）。

---

## §12 生产 URL 核验（curl 实测）

基址：`https://pepe-doge-breakout-radar.vercel.app`，时间 2026-09-08 ~16:25（UTC+8）。

| 对象 | 实测 | 判定 |
|---|---|---|
| 首页 `/` | `HTTP 200`，60,047B，~1.1s | live（页面可渲染） |
| `/api/market/overview` | `HTTP 200`，`{ok:true,status:live,errors:[],fundingProvider:binance}`，BTC 78349.9，PEPE INVALIDATED，DOGE INVALIDATED；**无 freshness/fundingTs 字段** | live；部署内容=HEAD（P0 未部署铁证） |
| `/api/market/candles?coin=PEPE&bar=4H&limit=2` | `HTTP 200`，`{ok:true,source:live,provider:okx}` | live；4H 收盘/盘中分离有据 |
| `/api/market/funding?coin=DOGE` | `HTTP 200`，`{ok:true,source:live,provider:binance,degraded:false}` | live（兜底链路首选命中，无需降级） |
| `/api/market/health` | `HTTP 200`，`summary:{okx:ok,binance:ok,funding:ok}`，`env:{runtime:vercel:production,region:hnd1,node:v24.18.0,serverTimeUtc:2026-09-08T08:25:05Z}` | live；多域名/Binance→OKX 全可用 |
| `/api/history` | `HTTP 200`，`{ok:true,count:21}` | live（纯本地恒可用） |
| `/api/similarity/current` | `HTTP 200`，`{ok:true,status:live,coin:PEPE}` | live |
| `/methodology` | `HTTP 200`，113,572B | live |
| `/asset/pepe` | `HTTP 200`，109,628B | live |
| 桌面显示一致性 | 首页/方法论/详情页均 200 且字节数与上一版同量级（60KB/113KB/109KB），无旧 UI 残留证据（HEAD 已清 V1 残留，`e8b10cb`） | 与上一版一致 |
| 刷新一致性 | `generatedAt:1788855872847` 与各 `prices.*.ts`（1788855871xxx）差 <1s；`lastConfirmedTs` 三币种同值 1788840000000（4H 对齐） | 新鲜（生产 live 窗口内） |
| unavailable 证据 | 代码级：candles/funding 失败 503 + 真实诊断；overview 无网 `status:unavailable` + `errors[]`。本次生产全 live，未触发（预期内） | 代码级 IMPLEMENTED，生产本次未触发 |
| stale→DATA_BLOCKED | HEAD 代码级：`action.ts:235` + AssetDetail 非 live 传 stale。生产本次 live 未触发 | 代码级有据，生产本次未触发；workdir P0 已补服务端三态（未部署） |
| degraded-fallback | 代码级：funding Binance→OKX + `degraded/note`；OKX 双域名；`health.attempts[]` 留痕。生产本次首选全命中 | 代码级 IMPLEMENTED，生产本次无需兜底 |

---

## §13 四态判定（CODE_COMPLETE / LOCAL_VALIDATED / PRODUCTION_DEPLOYED / PRODUCTION_DATA_VALIDATED）

| 判定项 | 结论 | 依据 |
|---|---|---|
| CODE_COMPLETE（HEAD=e55b0a6 功能完整） | **是** | §2–§6：行情/V2/ActionCard/CaseA/CaseB/UI 语义均有代码+单测证据；`ts-check/eslint/build` 全绿（§11，workdir 含 P0 下亦绿） |
| LOCAL_VALIDATED（本地验证通过） | **是（含脏改口径）** | `pnpm test 97/97` + `ts-check 0 错误` + `eslint 0 告警` + `next build 成功`，均在 workdir（含 P0）实测 |
| PRODUCTION_DEPLOYED（生产已含 HEAD） | **是（推断，高置信）** | 生产 serverTime（16:25+08）晚于 HEAD（12:25+08）；`overview live`；**反向铁证**：生产无 workdir P0 字段 → 生产内容恰为 HEAD。精确 Deployment SHA 需 Vercel 控制台复核 |
| PRODUCTION_DATA_VALIDATED（生产数据链路验证） | **是（本次 live 窗口）** | §12 全链路 200 + health 全绿 + overview live + 刷新一致；§7 PEPE/DOGE 真实 Case 可复现。stale/unavailable/degraded 分支本次未触发（交易所可达时预期内），仅代码级有据 |
| workdir P0 脏改部署状态 | **未部署、未提交** | 生产无 `freshness`/`fundingTs`；`git status` 9 改 + 2 新增未提交。部署需所有者先裁决§10.2 再 commit+push（**非本任务权限，仅记录**） |

---

## §14 结论（仅三选一）+ worker_done 回告字段

### 结论：**PARTIAL**

理由：

1. 量化冻结（区间一）+ ActionCard 解释层 + CaseA/CaseB + 测试/类型/Lint/构建 + 生产 live 全链路均有据通过（PASS_CANDIDATE 的必要条件已满足）。
2. 但以下三项需所有者裁决/时间演变，故不定 PASS_CANDIDATE、亦非 BLOCKED：
   - 方法论字面冲突（AGENTS 约束 vs 研究层 precision/误报率，见§9.1）待二选一裁决，裁决前维持现状是正确的冻结行为；
   - workdir 出现未提交 P0 脏改（含 2 处引擎输出行为变化，见§10.2），需裁决“可靠性诚实化”定性后再决定 commit+push+部署后复验；
   - DOGE live 两次漂移（RETEST_WATCH fixture → FAILED_BREAKOUT → INVALIDATED+STRUCTURE_VETO，见§7），映射符合代码但与旧截图/验收快照字面不一致，需评审时以 live 为准对齐预期，不视为回归。
3. 下一步（非本轮权限，仅记录）：所有者裁决§9.1 + §10.2 → 决定是否 commit/push workdir P0（当前生产=HEAD 可用，不推亦可运行）→ 部署后复验 `freshness` 字段 + Risk COMPUTED 口径 → 新 holdout 验证 M5（禁污染冻结 Test）→ 生产持续观察 live 下 ActionCard 路径。

### worker_done 回告字段

- 报告路径：`pepe-doge-breakout-radar-deepseek-v4-pro/CURRENT_STAGE_REVIEW_HANDOFF.md`（本文件，业务仓根目录）
- HEAD：`e55b0a6ad0955e3d7c24d4f1018d75bde3aa07e3`（main；workdir DIRTY，非 clean）
- git status：staged 0 / unstaged-modified 9 / untracked 新增源码 2（freshness.ts/test.ts）+ 本报告 1
- 测试结果：`pnpm test 97/97 PASS`（action 19 + freshness 24 含 P0-4a~4e），`ts-check 0 错误`，`eslint 0 告警`，`next build 成功`
- 生产 URL：`https://pepe-doge-breakout-radar.vercel.app`（overview `live`，health 全绿 `hnd1/vercel:production`；生产内容=HEAD，P0 未部署）
- PEPE Action：🔴 REJECT 当前淘汰（INVALIDATED + STRUCTURE_VETO，Setup80/Trigger100/Follow55，Age 416h）
- DOGE Action：🔴 REJECT 当前淘汰（live INVALIDATED + STRUCTURE_VETO，Setup50/Trigger60/Follow35，Age 60h；fixture RETEST_WATCH 与上一版 FAILED_BREAKOUT 均已漂移，特此说明）
