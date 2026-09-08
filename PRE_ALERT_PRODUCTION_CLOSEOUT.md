# PRE_ALERT_PRODUCTION_CLOSEOUT（报警前生产收口）

> 记录时间（UTC+8）：2026-09-08 18:16–18:25（UTC 10:16–10:25）｜记录人：dispatched worker（task_fa9e761d3ab4）
> 生产基址：`https://pepe-doge-breakout-radar.vercel.app`
> 唯一结论口径：PASS_CANDIDATE / PARTIAL / BLOCKED（三选一，见§15）。

---

## §1 任务与禁令遵守

- 任务：生产已确认跑 0639d86（Vercel success）后的生产复验 + 本收口报告。逐项复验首页 / PEPE / DOGE / Methodology 页与 overview / candles / funding / health API；确认 freshness 在位、ActionCard 来源/更新时间/freshness、LIVE 语义、缺数据语义、方案A文案、实时卡无胜率；双币 Live Case 按 LIVE_CASE_EVIDENCE_TEMPLATE 全字段抓取；三态 STALE→BLOCKED 与 UNAVAILABLE→BLOCKED 生产侧验证；8 组故障演练汇总。
- 禁令遵守：未改线上配置（无 push、无 deploy、无 Vercel/域名/环境变量操作）；未做手机端新工作（无 CSS/布局改动）；未做 Alert 系一切开发（无提醒/报警/声音/通知功能新增；`src/lib/action.ts` / `ActionCard.tsx` 内 alert/notification/notify/alarm/beep/push( 零命中，唯一"alert"为 `hardVetoKind` 变量名与 veto 文案）；未调阈值/权重/M5（工作树阈值零 diff，见§4）。
- 方法说明：页面 HTTP 状态用 curl 实测（SSR 首屏为加载态外壳，实时内容经客户端 fetch `/api/...` 水合——预期 SPA 行为）；当前行动原文用业务仓同版 `actionInputFromSignal` + `deriveActionState` + 生产 payload（含 OKX ticker 现价，经 `/tmp/dumpAction.ts` + tsx 实测推导），映射具确定性；不可构造项如实写模拟结论（见§6/§15）。

---

## §2 仓库 · 分支 · HEAD · commit 列表 · status · origin 同步

- 业务仓：`pepe-doge-breakout-radar-deepseek-v4-pro`，分支 `main`。
- 起止 HEAD（本轮零 commit，起止一致）：`0639d86c416dac920ab36f146503490b51fba525`
  `feat(radar): 报警前可靠性收口 P0新鲜度三态+缺数据安全语义+P1方案A落字（量化阈值权重零改动）`
  （2026-09-08 17:40:53 +0800）。
- 近端 commit 列表（`git log --oneline -5`）：
  - `0639d86` feat(radar): 报警前可靠性收口 P0新鲜度三态+缺数据安全语义+P1方案A落字
  - `e55b0a6` docs(radar): 洁癖对齐(删analysis.ts幽灵条目/补ActionCard组件/candles-funding改503诊断/测试数73)
  - `c831f59` docs(radar): 存档4散文件 + AGENTS测试数38→73(实测) + 补.preview门牌
  - `e8b10cb` merge(main): 并入 f586d4a 文档同步V2+清理V1残留（用户已确认）
  - `8c0d3ac` docs(radar): 新增项目完整进展总览 PROJECT_PROGRESS.md
- `git status --short`：`M next-env.d.ts`（`pnpm next build` 自动改写产物，惯例不计入业务改动）+ `?? PRE_ALERT_PRODUCTION_CLOSEOUT.md`（本报告文件，见§4）。
- origin 同步：`## main...origin/main`（`git fetch origin` 后仍一致，无 ahead/behind，除上述两项外无差异）；remote `https://github.com/wanghoufan/pepe-doge-breakout-radar-deepseek-v4-pro.git`。

---

## §3 生产 URL · 部署时间 · SHA

| 项 | 值 |
|---|---|
| 生产 URL | `https://pepe-doge-breakout-radar.vercel.app` |
| 部署内容指纹 | `freshness` + `fundingTs` 双字段在位（HEAD e55b0a6 及之前无此二字段，见 PRE_ALERT_RELIABILITY_REVIEW.md §9/§11）⇒ 生产内容 = 0639d86，高置信推断 |
| 生产 serverTime（health 实测） | `2026-09-08T10:16:14.607Z`，`region:hnd1`，`node:v24.19.0`，`runtime:vercel:production`，`durationMs:43` |
| 精确 Deployment SHA | **UNVERIFIED**（无 Vercel 控制台访问权限；以上为内容指纹推断，非控制台 SHA） |
| 本轮抓取窗口 | overview `generatedAt` 1788862573156 = 2026-09-08 18:16:13 +08 |

---

## §4 本轮修改逐项

1. 新增/覆写 `PRE_ALERT_PRODUCTION_CLOSEOUT.md`（本文件，业务仓根，收口报告）——唯一业务仓变更。
2. `M next-env.d.ts`——`pnpm next build` 自动改写产物，非手工业务改动（§12 构建实测附带）。
3. 其余工作树零改动：`git diff HEAD --stat` 仅上述 1 行产物；阈值/权重/M5/UI/Alert 零触碰。

---

## §5 Quant 审计

**NONE**——本轮无任何量化改动：阈值（`DEFAULT_V2_THRESHOLDS`）、权重（`DEFAULT_V2_WEIGHTS`）、指标算法（`indicators.ts`）、状态机（`state-machine.ts`）、回测（`backtest.ts`）、引擎输出行为（`v2/engine.ts`）、行动映射（`action.ts`）、新鲜度口径（`freshness.ts`）全部零 diff，无 Old/New/Reason/Impact/重测条目。

---

## §6 三态验证（STALE→BLOCKED / UNAVAILABLE→BLOCKED）

| 链路 | 代码证据 | 单测证据 | 生产侧可验证项 | 本轮生产状态 |
|---|---|---|---|---|
| STALE→BLOCKED | `src/lib/action.ts:234-237`（`dataStatus!=='ok'` 即 `DATA_BLOCKED`，关键价位清空，不沿用旧信号）+ `LiveRadar.tsx:99-111` 服务端 `freshness.status` 优先门控（`SourceLine` + `最后已收盘 4H K 线` + `资金费率来源` + `SourceFreshnessRow` + stale 时`最后有效更新`行）+ `freshness.ts:60-65`（feed 级缺失走 unavailable，不降级 stale） | P0-1i（`freshness.test.ts:137`）、P0-4b（`:237`） | 生产 payload `freshness:{status:ok,lastUpdatedTs:1788840000000,reason:null}` 在位；SSR 首屏 `⚫ 数据不足，暂停判断…不沿用旧信号` 加载态文案在位（DATA_BLOCKED 同款 copy，首页 SSR 实测命中） | 本次未触发（K 线龄 ~6.3h＜8h 阈值，属预期内）⇒ **模拟结论**：分支代码级有据＋单测 PASS，生产本次未触发 |
| UNAVAILABLE→BLOCKED | 同上 + `action.ts:492-` `actionInputFromSignal`（signal 为空即 unavailable，不拿快照冒充） | P0-1j（`:145`）、P0-4a（`:226`，OKX 全断→双币 DATA_BLOCKED） | 同上（同款 DATA_BLOCKED copy 在首页 SSR 首屏可验） | 本次未触发（health okx/binance/funding 全 ok）⇒ **模拟结论**，同上 |
| 限制（禁构造声明） | 不得为验证而改线上配置/断数据源/伪造 stale payload；生产侧不可构造项一律如实记模拟结论，不记 PASS_实测 | —— | —— | —— |

---

## §7 PEPE Live Case（生产真实数据，本次抓取，禁旧截图）

### 0. 元信息

| 项 | 值 |
|---|---|
| 记录时间 | 2026-09-08 18:16:13 +08 / 10:16:13Z（`overview.generatedAt` 1788862573156） |
| 业务仓 HEAD | `0639d86`（本报告 + build 产物外 clean） |
| 生产 URL | `https://pepe-doge-breakout-radar.vercel.app` |
| 部署内容 | 0639d86（内容指纹推断，精确 SHA UNVERIFIED，见§3） |
| 推导方式 | 同版 `actionInputFromSignal(signal,{asset:PEPE,price:3.631e-06,priceTs:1788862572863})` + `deriveActionState`（tsx 实测，非手写断言） |

### 1. Input

- `overview.generatedAt`：1788862573156（2026-09-08 18:16:13 +08）。
- 现价（`data.prices`）：PEPE `3.631e-06` @1788862572863；DOGE `0.09051` @1788862573064；BTC `78693.3` @1788862572968（与 generatedAt 差值均 ＜60s）。
- Candle：`lastCandleTs` 1788840000000；`lastConfirmedTs` 三币种同值 `{PEPE:1788840000000,DOGE:1788840000000,BTC:1788840000000}`（2026-09-08 12:00:00 +08，4H 对齐 PASS）；intraday 未收盘根 ts 1788854400000（PEPE o3.606e-6/h3.652e-6/l3.584e-6/c3.631e-6，`confirmed:false`，仅试探展示，不构成突破确认）。
- Funding：`fundingTs.PEPE` 1788854400002（16:00:00 +08）；`fundingProvider: binance`；费率龄 ~2.3h（＜24h，非 stale）。
- Env（BTC）：`price` 78693.3 / `return7dPct` -0.268% / `maxDrawdown24hPct` -2.20% / `closeAboveEma100` true / `trend` range / `source` okx / `hardBreakdown` false；`environment.gate` ALLOW（"市场环境中性偏暖"，memeBreadth -0.087%）。
- Freshness：`{status:ok, lastUpdatedTs:1788840000000, reason:null}`；K 线龄 ~6.3h（＜8h）；生产 payload 有 `freshness`/`fundingTs`（旧部署铁证反面：在位）。
- `dataQuality`：`missingFields[]` `staleFields[]` `degraded:false`，`summary` "关键数据完整"。

### 2. Output 五件套【PEPE】

- ① 当前行动：`code` REJECT / `🔴 当前淘汰` / `severity` danger / summary 原文："当前价格已经跌破结构失效位，本轮突破结构失效。本轮突破发生于约 416h 前，当前结构已经失效。"
- ② 关键价格：`currentPrice` 3.631e-06 / `breakoutLevel` 4.097e-06 / `invalidationLevel` 3.64626e-06 / `nextResistance` 3.879e-06 / `currentDistancePct` -11.37% / `breakoutExtensionPct` +0.5858% / `episodeAgeHours` 416。
- ③ 为什么（reasons 全文，tsx 实测）：✓"BTC 环境当前允许"；✗"STRUCTURE_VETO 已触发：币种跌破关键结构失效位"；✗"本轮币种结构已失效"；✗"当前价格 3.6310e-6 已低于结构失效位 3.6463e-6"。
- ④ 接下来观察：→"系统识别到新的 Independent Breakout Episode → 重新进入观察或跟踪（不沿用旧 episode）"；`episodeStatus`："本轮 Episode 已失效，等待新的蓄势与 Independent Breakout Episode。"
- ⑤ 新鲜度/数据状态：`dataFreshness {status:ok, lastUpdatedTs:1788862572863, reason:null}`；`最后有效更新`行仅非 ok 时显示，本次不显示，符合预期；`history {setupScore:80, triggerScore:100, followThroughText:"FAILED · 55", historicalOnly:true}` + warnings 原文："Setup 80 / Trigger 100 为本轮历史突破评分，仅用于复盘，不代表当前仍可作为突破候选。"（生产 UI 灰化展示）。
- 附加：`state` INVALIDATED（结构失效）/ `env` ALLOW / `episodeId` EP-PEPE-001 / Setup 80 / Trigger 100 / Follow 55 / Risk 0（COMPUTED，数据齐全）/ EntryHeat 0·低 / Veto STRUCTURE_VETO（币种跌破关键结构失效位）/ breakout{ts:1787342400000, level:4.097e-06, close:4.121e-06, confirmed:true, barsSinceBreakout:104, hoursSinceBreakout:416, trigger 7/7, isEpisodeStart:false} / `keyLevels.ema20` 3.595780193990126e-06 / features{compressionRatio 0.9014, atrPct60d 23.53, volRatio 0.935, distToRes -7.04%, base 27 根, higherLow true, relStrength +0.99% (pct80), emaBullishStack true, atrExp 1.11, 距EMA20 +0.28%}。

---

## §8 DOGE Live Case（生产真实数据，本次抓取，禁旧截图）

Input 与§7 同源（同 `generatedAt` / 同 K 线对齐 ts / 同 freshness；`fundingTs.DOGE` 1788854400002；intraday DOGE ts 1788854400000 o0.08923/h0.09081/l0.08876/c0.09051 `confirmed:false`）。

### Output 五件套【DOGE】

- ① 当前行动：`code` REJECT / `🔴 当前淘汰` / `severity` danger / summary 原文："当前价格已经跌破结构失效位，本轮突破结构失效。本轮突破发生于约 60h 前，当前结构已经失效。"
- ② 关键价格：`currentPrice` 0.09051 / `breakoutLevel` 0.08995 / `invalidationLevel` 0.08957259999999999（API 原始浮点伪影，UI 层 `formatPrice` 已屏蔽，只列不修）/ `nextResistance` 0.09529 / `currentDistancePct` +0.62%（相对突破位为正；否决依据为 4H 收盘结构 + STRUCTURE_VETO，非 ticker 瞬时价）/ `breakoutExtensionPct` +0.8449% / `episodeAgeHours` 60。
- ③ 为什么（reasons 全文，tsx 实测，共 3 条）：✓"BTC 环境当前允许"；✗"STRUCTURE_VETO 已触发：币种跌破关键结构失效位"；✗"本轮币种结构已失效"。（本次 ticker 高于失效位，故无第 4 条价格跌破行——与 PEPE 差异属映射确定性行为，非回归。）
- ④ 接下来观察：→"系统识别到新的 Independent Breakout Episode → 重新进入观察或跟踪（不沿用旧 episode）"；`episodeStatus`："本轮 Episode 已失效，等待新的蓄势与 Independent Breakout Episode。"
- ⑤ 新鲜度/数据状态：`dataFreshness {status:ok, lastUpdatedTs:1788862573064, reason:null}`；`最后有效更新`行不显示（ok，符合预期）；`history {setupScore:50, triggerScore:60, followThroughText:"FAILED · 35", historicalOnly:true}`；warnings 空（DOGE 本次无复盘注 stories 行，属分支差异）。
- 附加：`state` INVALIDATED / `env` ALLOW / `episodeId` EP-DOGE-002 / Setup 50 / Trigger 60 / Follow 35 / Risk 0（COMPUTED）/ EntryHeat 0·低 / Veto STRUCTURE_VETO / breakout{ts:1788624000000, level:0.08995, close:0.09071, volumeRatio 6.54, confirmed:true, bars 15, hours 60, trigger 1/1, isEpisodeStart:true} / `ema20` 0.08894100257132964 / features{compressionRatio 1.445, atrPct60d 64.71, volRatio 1.825, distToRes -6.36%, base 15 根, higherLow true, relStrengthPct -0.087% (pct90), emaBullishStack true}。
- 漂移注记：DOGE 曾两次漂移（RETEST_WATCH fixture → FAILED_BREAKOUT → INVALIDATED+STRUCTURE_VETO）；本次以 live 为准，映射符合 `action.ts` 结构分支，不视为回归；复验禁拿旧截图断言现状。

---

## §9 Missing Data 语义（缺数据不示低风险）

- 生产本次：双币 `dataQuality` 完整（missing/stale 空，degraded false），Risk 0 为 COMPUTED 真值，非缺数据示低——PASS。
- 缺数据语义代码级有据：funding 缺失/过期或任一 Risk 条件 unknown ⇒ Risk `DATA_UNAVAILABLE`（value null）+ EntryHeat 未知（`v2/engine.ts:92 resolveRiskLayer`，P0-2a~2g）；feed 缺失 ⇒ overview unavailable ⇒ 双币 `DATA_BLOCKED`（P0-4a）；K 线不足 20 根 ⇒ `DATA_VETO` + `MARKET_BLOCKED`，不产 0 分（P0-4d）。
- 生产首页 SSR fallback 落字"数据不足，暂停判断。已停止输出行动候选，不沿用旧信号。"（DATA_BLOCKED 同款 copy，本轮 SSR 实测命中，见§13-14）——缺数据时不展示任何低风险表述，文案在位。

---

## §10 方案A（冻结）

- 方法论页生产实测在位原文："方案A（冻结）：研究指标（误报率/Precision/Recall/FPR/Success 率）仅离线研究用，不进入 ActionCard、实时信号与任何报警/通知，不包装成胜率；ActionCard 只输出当前行动、关键价格与证据，不输出概率化收益表述。"（本轮 curl 生产页全文检索命中，上下文含"不构成任何买卖决策依据"与"不构成收益承诺"声明。）
- 双 Live Case 推导输出（§7/§8）含行动+价格+证据（reasons/nextConditions/episodeStatus/dataFreshness），无胜率/准确率/假突破概率/概率化收益表述——PASS。
- 实时卡无胜率：`ActionCard.tsx` / `LiveRadar.tsx` / `AssetDetail.tsx` / `action.ts` 内"胜率/准确率/假突破概率"零命中（唯一命中为 `action.ts:8` 禁令注释与方法论页禁用声明本身）——PASS。

---

## §11 故障演练 8 组（结果汇总）

| # | 组 | 口径 | 结果 |
|---|---|---|---|
| G1 | STALE→BLOCKED（K 线停更超 8h，signals 仍在，强制 BLOCKED 不沿用旧突破） | P0-1i（`freshness.test.ts:137`） + P0-4b（`:237`） | PASS |
| G2 | UNAVAILABLE→BLOCKED（feed 级失败/时间戳缺失） | P0-1j（`:145`） + P0-4a（`:226`，双币 `DATA_BLOCKED`，关键价位清空） | PASS |
| G3 | OKX 全断 → overview unavailable → 双币 Action DATA_BLOCKED | P0-4a | PASS |
| G4 | K 线停更 stale 但 signals 仍在 → 强制 DATA_BLOCKED | P0-4b | PASS |
| G5 | funding 全断 → overview 仍可 live，但 EntryHeat 未知（禁示低） | P0-4c（`:254`） | PASS |
| G6 | K 线不足 20 根 → DATA_VETO + MARKET_BLOCKED（不产 0 分） | P0-4d（`:266`） | PASS |
| G7 | funding 时间戳非法/空 → unavailable | P0-4e（`:275`） | PASS |
| G8 | Risk 任一 unknown / funding 缺失或过期 → DATA_UNAVAILABLE（即使分值 0 也不示低；引擎集成 funding 缺失/过期/齐全三态） | P0-2a~2g（`v2` engine 单测） | PASS |

8 组全部在 `pnpm test` 内实测通过（97/97 的子集），生产本次 live 未触发任一降级分支（预期内，见§6 模拟结论）。

---

## §12 自动测试四件套（本轮实测，含本报告时点 workdir）

| 项 | 命令 | 数字 | exit |
|---|---|---|---|
| 单测 | `pnpm test` | **97/97 通过，0 失败**（duration ~264ms） | 0 |
| 类型 | `pnpm ts-check`（`tsc -p tsconfig.json`） | **0 错误** | 0 |
| Lint | `pnpm lint:build`（`eslint . --quiet`） | **0 告警** | 0 |
| 生产构建 | `pnpm next build`（Next 16.1.1 Turbopack） | **成功**；16 路由：`/` `/api/history` `/api/history/[id]` `/api/market/{candles,funding,health,overview}` `/api/similarity` `/api/similarity/current` `/asset/[coin]`（pepe/doge SSG）`/history` `/history/[id]` `/methodology` `/robots.txt` `/similarity` `/_not-found` | 0 |

---

## §13 生产验证逐项（HTTP/API 结果，本轮 18:16–18:20 +08 实测）

| # | 对象 | 实测 | 判定 |
|---|---|---|---|
| 1 | 首页 `/` | 200（SSR 外壳 + DATA_BLOCKED 同款加载态文案在位；实时区经水合拉取 overview） | PASS |
| 2 | `/asset/pepe` | 200 | PASS |
| 3 | `/asset/doge` | 200 | PASS |
| 4 | `/methodology` | 200（方案A冻结文案逐字在位，见§10） | PASS |
| 5 | `/api/market/overview` | 200 `{ok:true,status:live}`，`fundingProvider:binance`，`freshness`+`fundingTs` 在位，BTC 78693.3，summary"环境中性：BTC 区间震荡；PEPE 结构失效，DOGE 结构失效；BTC 24h 回撤 -2.20%" | PASS |
| 6 | `/api/market/candles?coin=PEPE&bar=4H` | 200 `{ok:true,source:live,provider:okx}` | PASS |
| 7 | `/api/market/candles?coin=DOGE&bar=4H` | 200 `{ok:true,source:live,provider:okx}` | PASS |
| 8 | `/api/market/funding?coin=PEPE` | 200 `{ok:true,source:live,provider:binance,degraded:false}` | PASS |
| 9 | `/api/market/funding?coin=DOGE` | 200 `{ok:true,source:live,provider:binance,degraded:false}` | PASS |
| 10 | `/api/market/health` | 200 `summary:{okx:ok,binance:ok,funding:ok}`，serverTime 2026-09-08T10:16:14.607Z，region hnd1 | PASS |
| 11 | `/api/similarity/current?coin=PEPE` | 200 `{ok:true,status:live}` | PASS |
| 12 | `/api/history` | 200（21 事件，纯本地） | PASS |
| 13 | 刷新一致性 | `lastConfirmedTs` 三币种同值 1788840000000（4H 对齐）；`prices` 三币种 ts 与 generatedAt 差值 ＜60s | PASS（新鲜） |
| 14 | ActionCard 来源/更新时间/freshness | 代码：`LiveRadar.tsx:99-111`（`SourceLine` provider okx + fetchedAt=`generatedAt` + `最后已收盘 4H K 线` + `资金费率来源 Binance` + `SourceFreshnessRow` 8 路，由 `generatedAt/lastConfirmedTs/prices/fundingTs` 驱动——生产 payload 全部在位）；live 时 `最后有效更新`行按设计隐藏 | PASS |
| 15 | 正常行情 LIVE | `status:live` + summary 环境中性（BTC 区间震荡，双币结构失效，24h 回撤 -2.20%） | PASS（LIVE） |
| 16 | 实时卡无胜率 | §7/§8 推导输出无概率化表述；组件内"胜率"零命中（见§10） | PASS |

---

## §14 证据路径（业务仓内相对路径，无临时目录引用）

- 本报告：`PRE_ALERT_PRODUCTION_CLOSEOUT.md`
- 证据模板：`LIVE_CASE_EVIDENCE_TEMPLATE.md`
- 前序评审：`PRE_ALERT_RELIABILITY_REVIEW.md`（§9/§11 旧部署无 freshness 铁证出处）、`CURRENT_STAGE_REVIEW_HANDOFF.md`
- 三态：`src/lib/freshness.ts`（`CANDLE_STALE_AFTER_MS` 8h / `FUNDING_STALE_AFTER_MS` 24h / `deriveOverviewFreshness` feed 级 unavailable）、`src/lib/freshness.test.ts`（P0-1i/P0-1j/P0-4a~4e 演练）、`src/lib/market-service.ts`
- 行动映射：`src/lib/action.ts:122-128`（ACTION_META）、`:234-237`（DATA_BLOCKED）、`:263-323`（REJECT 结构分支）、`:492-`（actionInputFromSignal）；单测 `src/lib/action.test.ts`（TEST 1/10/11/13/16-18，BANNED 词表断言）
- 展示：`src/components/market/ActionCard.tsx`（行动卡）、`LiveRadar.tsx:99-111`（来源/更新时间/8 路新鲜度行）、`AssetDetail.tsx`、`SignalCard.tsx`、`DataStatus.tsx`（`SourceLine`/`SourceFreshnessRow`）
- 引擎/ veto：`src/lib/v2/engine.ts:92`（resolveRiskLayer）、`:509`（STRUCTURE_VETO）、`src/lib/state-machine.ts`
- 方法论方案A：`src/app/methodology/page.tsx:136-138`（DISCLOSURES 方案A条目）
- 生产 payload 关键值已内联记入§7/§8/§13（抓取命令口径：`curl -s <prod>/api/market/overview|health|candles|funding`，窗口 18:16–18:20 +08）。

---

## §15 限制与终态

限制：

1. 精确 Deployment SHA 未经 Vercel 控制台核对，记 UNVERIFIED；部署内容=0639d86 为 `freshness`/`fundingTs` 内容指纹高置信推断。
2. 页面实时内容经客户端水合，curl 仅验 SSR 外壳 + API；最终渲染态由 API payload × 同版确定性映射（tsx 实测）推导，未做真机浏览器截图（禁旧截图；本次亦未新截断言现状）。
3. 三态降级分支生产本次未触发（全 live），STALE→BLOCKED 与 UNAVAILABLE→BLOCKED 记模拟结论（代码级有据＋单测 PASS），不可构造项未强行构造。
4. DOGE ticker 瞬时价（0.09051）高于失效位但否决成立——否决依据为 4H 收盘结构（服务端信号）+ STRUCTURE_VETO，非 ticker；推导原文如实记录，不调和。
5. API 原始 `invalidation` 浮点伪影（`0.08957259999999999`）维持现状（UI 层已屏蔽，只列不修）。
6. `next-env.d.ts` 脏改系构建产物，P1 结论不受影响。

终态（三选一）：**PASS_CANDIDATE**——生产 0639d86 内容在位（freshness/fundingTs 双字段为证），4 页＋8 API 全 200，LIVE 正常行情，双币 REJECT（INVALIDATED+STRUCTURE_VETO，tsx 同版映射复现），方案A文案在位，实时卡无胜率，缺数据语义与 8 组故障演练全部 PASS，自动测试四件套全绿（test 97/97、ts-check 0、lint 0、build 成功），Quant 审计 NONE；遗留仅 UNVERIFIED SHA 与未触发分支的模拟结论（属预期内限制，不构成 BLOCK）。
