# BUGS（QA 缺陷台账）

> 范围：HEAD `505ef64` Action Card 当前行动卡（UX 决策解释层）。
> 验证环境：`pnpm test` 69/69、`tsc` 0 错误、`eslint --quiet` 0 告警；dev server `:5000` 真实运行（OKX live 可达，与沙箱无网预期不同，本轮按 live 路径验证）。
> 约束：QA 只写本文档与 `QA_CHECKLIST.md`，不改业务代码。`docs/roles/qa.md` 在本仓库不存在，特此标注。

## P2 / Low

### BUG-001 条件清单仍用旧文案 `rolling 阻力`，与新术语不一致
- 位置：`src/lib/v2/engine.ts:554`（`label: '4H 收盘突破 rolling 阻力'`）
- 复现：`GET /api/market/overview` → `pepe/doge.triggerConditions[].label` 含 `4H 收盘突破 rolling 阻力`（2026-09-08 实测双币种均命中）。
- 预期：本轮已将用户面统一为「本轮突破位 / 当前下一压力 / 结构失效位 / 突破当根超越幅度 / 当前距突破位」（`SignalCard`/`AssetDetail`/`ActionCard`），条件清单应同步改名或给出映射，否则同一页面出现两套阻力叫法。
- 实际：条件清单（`SignalCard.ConditionList`、`AssetDetail` 信号判断依据直接渲染 `c.label`）仍显示旧文案。
- 影响：纯文案一致性，不影响判定。

### BUG-002 方法论残留旧文案 `风险分`
- 位置：`src/app/methodology/page.tsx:152`（`全程由风险分与硬否决独立把关`）
- 预期：本轮已将 `Risk → Entry Heat · 追高/过热`（`SignalCard`/`AssetDetail`/`ACTION_CARD_REPORT §6`），方法论导语应同步为 Entry Heat。
- 实际：导语仍称「风险分」。

### BUG-003 Follow-through `WEAK≥35` 文档与实现不一致
- 位置：`src/lib/action.ts:159-184`（`describeFollowThrough`）vs `ACTION_CARD_REPORT.md §8`（`Follow-through HEALTHY≥60/WEAK≥35`）
- 复现：`describeFollowThrough('COMPUTED', 10, true, 10)` → `{grade:'WEAK'}`；`34/35/59` 亦全为 `WEAK`，代码中不存在 `35` 分支（仅 `>=60 → HEALTHY`，其余 `→ WEAK`）。
- 预期二选一：补 `35` 分支语义，或将文档修正为「`HEALTHY≥60`，其余为 `WEAK`（display-only）」。
- 影响：展示分档说明，不参与交易判定（源码已声明 display-only）。

## Info（建议，不判缺陷）

### INFO-001 `partial` 状态为死类型
- `LiveRadar`/`AssetDetail` 的 `OverviewResp.status` 含 `'live' | 'partial' | 'unavailable'`，但 `src/lib/market-service.ts:226` 只返回 `'live' | 'unavailable'`（`!okxOk || !canAnalyze ? 'unavailable' : 'live'`）。
- 建议：删除 `'partial'` 或实现真正的部分可用语义。当前无实际影响（`unavailable` 时 `pepe/doge` 为 `null` → `DATA_BLOCKED`，两端一致）。

### INFO-002 `price == invalidationLevel` 时少一条失效理由
- 位置：`src/lib/action.ts:274`（`currentPrice < invalidationLevel` 才追加「已低于结构失效位」）。
- `==` 时仍为 `REJECT`（正确），只是少一条理由。建议改为 `<=`（需产品确认等值语义）。

### INFO-003 `heldAbove=null` 按结构有效处理
- 位置：`src/lib/action.ts:297`（`heldAboveBreakoutLevel !== false` 即有效）。
- `breakoutConfirmed=true + heldAbove=null`（跟随数据缺失）→ `BREAKOUT_TRACK`。建议产品确认：未知是否应降级描述（当前 `PENDING` 文案已提示「尚无足够后续数据」，可接受）。

### STYLE-DEBT 硬编码 hex（历史遗留 + 本轮新增）
- `SignalCard.tsx:105,109,205`、`AssetDetail.tsx:207-209`：`#8AB4F8/#4FC3F7/#fb5e6e`（历史遗留）+ `#f5a623/#3ddc84`（本轮 `EntryHeatLine` 新增）。
- `AGENTS.md` 要求新增配色用 `--radar/--pepe/--doge/--btc/--bull/--bear/--warn` token。可映射：`#8AB4F8→--btc`、`#fb5e6e→--bear`、`#3ddc84→--bull`、`#f5a623→--warn`。功能无影响。

## 本轮验证通过（无缺陷）
- 优先级：`DATA_BLOCKED > REJECT > OVERHEATED > RETEST_WATCH > BREAKOUT_TRACK > WATCH > NO_ACTION` 全对（含 `BLOCK+高热→REJECT`、`RETEST+高热→OVERHEATED`、`FAILED/MARKET_BLOCKED→REJECT`、`无结构+高热→NO_ACTION/WATCH`）。
- Live 映射：`GET /api/market/overview`（live）`PEPE INVALIDATED+STRUCTURE_VETO+Setup100/Trigger100 → REJECT`；`DOGE RETESTING+无否决 → RETEST_WATCH`；与 `action.test.ts` TEST 11/12 一致；反向（DOGE 模拟跌破）→ `REJECT`；同输入确定性一致。
- 边界：EntryHeat `39→低/40→中/69→中/70→高`；`currentDistancePct 24.99→BREAKOUT_TRACK/25→OVERHEATED`（`chaseDistancePct=25`）；`stale/unavailable→DATA_BLOCKED` 且关键价位清空。
- 禁用语：live 双币种输出无「买入/开仓/胜率/建议」；全站「胜率/准确率/假突破概率」仅出现在「不输出…」声明中，无数值承诺。
- 改名：`Risk→Entry Heat`、`突破位→本轮突破位`、`rolling阻力→当前下一压力`、`失效观察位→结构失效位`、`突破距离→突破当根超越幅度` + 新增「当前距突破位」在 `SignalCard`/`AssetDetail`/`ActionCard` 生效；失效后历史评分灰化 + 「仅用于复盘」标签生效。
- 回归：6 页 + `/api/history|similarity|market/overview|similarity/current|market/candles|market/funding` 均 200；21 事件 + 21 截图完整；非法输入 `coin=INVALID→invalid_coin`、`history/INVALID→404`、`/asset/btc→404` 正确。
- 已知限制：本环境无真实浏览器，仅做 SSR HTML + API + 纯函数映射验证，未做 hydrated 像素级验证（`ACTION_CARD_REPORT §9` 同口径）。
