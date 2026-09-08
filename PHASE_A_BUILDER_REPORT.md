# Phase A Builder 回告（4H K 线时间语义 + Freshness 修正｜禁 commit/push，未提交）

- HEAD：0639d86。工作区初始即有 2 处非本任务残留：`M next-env.d.ts`（1 行，dev/build routes.d.ts 引用差异，构建产物）、`?? PRE_ALERT_PRODUCTION_CLOSEOUT.md`（前人未跟踪文件）。本任务未碰两者、未 commit/push。
- 禁项自查：未新增策略 / Setup-Trigger 权重 / Follow 算法 / Env 阈值 / EntryHeat 阈值 / HardVeto / Rolling42 / Episode / Walkforward / MFE-MAE / M5 / holdout / 手机端专项 / 胜率包装。`config.ts`、`v2/engine.ts`、`action.ts`、`indicators.ts`、`state-machine.ts` 零改动。

## 1. 改动文件（9 改 + 1 新增）

- `src/lib/time.ts`：统一 open/close 语义注释；新增 `candleCloseTs`、`current4HOpenTs`、`expectedLastConfirmedOpenTs`。
- `src/lib/freshness.ts`：集中 `CANDLE_FRESHNESS_GRACE_MS`；新增 `assessCandleFreshness`（LIVE/STALE/UNAVAILABLE）、`deriveCandleOverviewFreshness`（三币合并）、`candleStatusToFeed`、`formatAgeCn`、`candleMainCopy`、`priceMainCopy`；`deriveOverviewFreshness` 改写为 K 线期望 Bar 对比 + 现价 8h 年龄分离判定；旧 `lastConfirmedTs` 保留。
- `src/lib/market-service.ts`：`MarketOverview` 新增 `candle: CandleOverviewFreshness`；`lastConfirmedTs` 注释标 open 语义。
- `src/lib/market-client.ts`：`until` 注释标 openTs 语义（逻辑零改）。
- `src/app/api/market/overview/route.ts`：输出 `candle{current4HOpenTs, expectedLastConfirmedOpenTs/CloseTs, lastConfirmedOpenTs/CloseTs(per coin), candleLagBars(per coin), freshnessStatus, staleReason}`；reason 编码 LIVE→null / STALE→`latest_confirmed_candle_behind_expected_bar` / UNAVAILABLE→`confirmed_candle_missing`。
- `src/lib/format.ts`：新增 `formatClock`（区间展示全站一种）。
- `src/components/market/DataStatus.tsx`：新增 `CandleFreshnessBlock`（现价/K线/形成中三行分离）；`SourceFreshnessRow` K 线三路改期望 Bar 口径 + 统一主口径。
- `src/components/market/LiveRadar.tsx`：接入三行块（PEPE/DOGE）+ 头部 `最近4H收盘<close>·K线<STATUS>`。
- `src/components/market/AssetDetail.tsx`：接入单币三行块；K 线行与图表脚注改 close 口径区间展示。
- 新增 `src/lib/candle-freshness.test.ts`：A-TEST1~10。

## 2. Gate 四件套（全 PASS）

- `pnpm test`：107/107 通过（含新增 10 项；P0 旧用例全绿）。
- `pnpm ts-check`：0 错误。
- `pnpm lint:build`：0 错误（quiet）。
- `pnpm exec next build`：成功（全路由输出正常）。

## 3. A-TEST1~10 结果（10/10 PASS）

- A-TEST1：18:20/actual12:00 → LIVE，最近收盘“2小时20分钟前”（断言禁含“6小时”）。
- A-TEST2：12:00/actual08:00 → LIVE。
- A-TEST3：actual08:00 落后期望(12:00) lag1 且超宽限 → STALE → DATA_BLOCKED，且 code ∉ {BREAKOUT_TRACK, RETEST_WATCH, WATCH}，breakoutLevel=null。
- A-TEST4：形成中 16:00 `isCandleClosed=false`；confirmed 过滤后 until=12:00 ≠ intraday，LIVE。
- A-TEST5：12:05/actual04:00（lag1 宽限期内）→ LIVE，staleReason null（边界不误判）。
- A-TEST6：20:00/actual08:00 lag2 → STALE（宽限不包庇）。
- A-TEST7：null/NaN/-1/Infinity → UNAVAILABLE + `confirmed_candle_missing` → DATA_BLOCKED。
- A-TEST8：ticker 新鲜 + K 线 STALE → overview stale → DATA_BLOCKED。
- A-TEST9：K 线 LIVE + funding 缺失 → risk DATA_UNAVAILABLE + EntryHeat null/未知。
- A-TEST10：三币同语义合并（一币 STALE → 整体 STALE）；三币主口径均为 `K线X·LIVE·最近收盘2小时20分钟前`（closeTs 计时）。

## 4. Quant 审计（gracePeriod 单列 + 输出影响）

| 项 | Old | New | Reason | 是否改输出 |
|---|---|---|---|---|
| gracePeriod | 无（期望 Bar 一收盘即 STALE，收盘后最初几分钟必误判） | `CANDLE_FRESHNESS_GRACE_MS = 15min`，`freshness.ts` 集中唯一定义（grep 确认无散落硬编码；测试仅 pin 常量值） | OKX confirm 翻转 + 服务端 60s 缓存 + 轮询间隔，收盘数据到达有分钟级延迟；宽限仅覆盖 lag1（只缺刚收盘一根），lag≥2 照判 STALE | 会：收盘后宽限期内缺 Bar 由 STALE→LIVE；宽限期外与过期行为不变 |
| K 线 stale 口径 | 8h 年龄（openTs 当更新时间，虚增 4h） | 期望收盘 Bar 对比 + closeTs 计时 | 与交易所 4H 边界对齐，消除系统性 4h 偏差 | 会：新鲜度更准；STALE/UNAVAILABLE 仍走 DATA_BLOCKED，信号门控语义不变 |
| 现价口径 | 与 K 线混用同一 8h 判定 | 独立 8h 年龄判定，三行分离显示 | 现价 ticker 与 K 线收盘是两条链路 | 显示层分离；门控取最差，结果偏保守（符合 P0 安全语义） |
| 策略/阈值/权重/评分 | — | 零改动（diff 无 `config.ts`/`v2/`/`action.ts`） | Phase A 禁项 | 否 |

## 5. 是否可进 Phase B

- 可进。Gate 全绿，10 项测试覆盖任务书全部判态，禁项零触碰，API 加性字段（旧 `lastConfirmedTs`/`freshness`/`status` 契约不变，前端回退分支保留）。
- 遗留非阻塞：初始工作区 2 处残留（见顶）建议由协调方决定清理；`priceMainCopy`/`candleMainCopy` 中文时长与 `relativeTime` 并存（前者是 Phase A 主口径，后者旧行保留，未删除旧文案以保兼容）。
