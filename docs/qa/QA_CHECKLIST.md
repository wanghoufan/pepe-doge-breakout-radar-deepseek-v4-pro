# QA_CHECKLIST（Action Card 长期回归清单）

> 适用：`src/lib/action.ts` + `ActionCard` + `SignalCard` + `AssetDetail` + `methodology` 当前行动节。
> 基线：`pnpm test`（`src/lib/*.test.ts` + `src/lib/v2/*.test.ts`）、`pnpm tsc -p tsconfig.json`、`pnpm eslint --quiet`。
> 时间统一 UTC 存储、Asia/Shanghai 展示（`src/lib/format.ts`）。

## A. 冒烟（每次必跑）
- [ ] `pnpm test` 全绿（含 `action.test.ts` 15 项：PEPE→REJECT、DOGE→RETEST_WATCH、禁用语、historicalOnly、AND 外无关性）。
- [ ] `tsc` 0 错误，`eslint --quiet` 0 告警。
- [ ] 6 页 200：`/`、`/asset/pepe`、`/asset/doge`、`/history`、`/similarity`、`/methodology`；`history/P01` 200、`history/INVALID` 404、`/asset/btc` 404。
- [ ] 8 接口 200：`market/overview|candles|funding`、`history|history/:id|history/:id/window`、`similarity|similarity/current`；`coin=INVALID → invalid_coin`。

## B. 正常流程（7 态各一例）
- [ ] `DATA_BLOCKED`：`dataStatus != 'ok'` → 停候选、不沿用旧信号、关键价位清空、`next=[数据恢复→重新评估]`。
- [ ] `REJECT`：`STRUCTURE_VETO` / `env BLOCK` / `FAILED_BREAKOUT` / `INVALIDATED` / `MARKET_BLOCKED` 任一 → 淘汰；高分不可覆盖（Setup100/Trigger100 仍 REJECT）。
- [ ] `OVERHEATED`：结构有效 +（EntryHeat 高 或 `currentDistancePct ≥ chaseDistancePct(25)`）→ 过热（文案禁「不能涨了」）。
- [ ] `RETEST_WATCH`：`RETESTING` + 结构有效 + 无否决。
- [ ] `BREAKOUT_TRACK`：`BREAKOUT_CONFIRMED / FOLLOW_THROUGH_PENDING / HEALTHY_BREAKOUT` + 无否决；`PENDING` 缺失不判低质。
- [ ] `WATCH`：`NEAR_BREAKOUT / BUILDING_SETUP` → 只观察 + 误报说明（NEAR~30%/BUILDING~41%），不产生跟踪。
- [ ] `NO_ACTION`：`NO_SETUP` 兜底。

## C. 反向操作
- [ ] 跟踪中出现 `STRUCTURE_VETO` / 跌破 `invalidationLevel` → 转 `REJECT`，历史评分 `historicalOnly=true` + 灰化。
- [ ] 新 `Independent Breakout Episode` → 不沿用旧 episode（`next.outcome` 含「不沿用旧 episode」）。
- [ ] 数据恢复（`unavailable → live`）→ 重新评估，非沿用旧信号。

## D. 边界
- [ ] EntryHeat：`39→低 / 40→中 / 69→中 / 70→高 / null→未知`。
- [ ] `currentDistancePct`：`24.99→非过热 / 25→OVERHEATED`。
- [ ] Follow-through：`59→WEAK / 60→HEALTHY`；`PENDING/WAITING/DATA_UNAVAILABLE/null→PENDING`；`heldAbove=false→FAILED`。
- [ ] `price == invalidationLevel`（见 BUGS INFO-002，当前少一条理由但仍 REJECT）。
- [ ] `heldAbove=null + breakoutConfirmed`（见 BUGS INFO-003，当前按有效处理）。

## E. 连续操作 / 确定性
- [ ] 同 `ActionInput` 两次 `deriveActionState` 输出 `deepEqual`。
- [ ] 输入无 `outcome/success/failure/mfe/mae/future` 字段（TEST 15）。

## F. 状态一致性
- [ ] 首页 `LiveRadar`（live 时 PEPE→REJECT、DOGE→RETEST_WATCH）与详情页 `AssetDetail` 同信号同结论。
- [ ] `ActionCard` 永远在卡片最前（Level1 行动 → Level2 关键价格 → Level3 为什么/接下来观察）。
- [ ] 失效后 `Setup/Trigger/Follow` 灰化 + 「本轮历史突破评分，仅用于复盘」。
- [ ] `Follow-through` 显示 `HEALTHY/PENDING` 状态优先，缺失不显示 0 分。
- [ ] 「突破当根超越幅度」与「当前距突破位」禁止混用（两字段独立）。

## G. 关联关系
- [ ] `actionInputFromSignal` 组装无判定：`entryHeat←risk(COMPUTED)`、`currentDistancePct=(price/level-1)*100`、`breakoutExtensionPct←breakout.distancePct`。
- [ ] 条件清单 `rolling 阻力` 改名跟进（见 BUGS-001）。
- [ ] 方法论「风险分」改名跟进（见 BUGS-002）。

## H. 实体完整生命周期
- [ ] `蓄势(WATCH) → 突破跟踪 → 回踩观察 → 失效(REJECT) → 新 episode` 全链条可达（合成输入 + live PEPE/DOGE 两端点）。
- [ ] 21 事件（P01–P11/D01–D10）+ 21 截图 + `window` 快照完整；`event-metrics.json` 数值未动。

## I. 约束回归（硬门槛）
- [ ] 仅 PEPE/DOGE + BTC；无其他币种（非法 coin 拒绝）。
- [ ] 无胜率/准确率/假突破概率数值与收益承诺；「胜率」仅出现在「不输出…」声明。
- [ ] 无「买入/开仓/建议」表述（禁用语扫描）。
- [ ] 配色用 token（见 STYLE-DEBT，新 hex 需映射 `--btc/--bear/--bull/--warn`）。
- [ ] 自绘 SVG，无新增图表依赖；仅 pnpm。
