# Action Card Implementation Report（当前行动卡）

> 本轮是 UX / Decision Explanation 层，不优化量化策略、不调任何 Setup / Trigger / Risk 权重。
> 科学边界：M1–M4 尚未证明具有样本外增量，M5 尚待新的 holdout 验证。

## 1. 本轮修改范围
- 仅改 UX / Decision Explanation（`src/lib/action.ts` 纯函数 + `ActionCard` 组件 + 页面装配 + 方法论文案）。
- **本轮未修改底层量化策略。**（底层 bug fix：无。）
- 新增文件：`src/lib/action.ts`、`src/lib/action.test.ts`（15 项）、
  `src/components/market/ActionCard.tsx`、`ACTION_CARD_REPORT.md`（本文件）。
- 修改文件：`SignalCard.tsx`（ActionCard 置顶 + 改名 + 灰化）、`AssetDetail.tsx`（同上）、
  `methodology/page.tsx`（边界与改名同步）。

## 2. Action 状态（7 个，6 主 + 1 兜底）
REJECT（🔴当前淘汰）/ WATCH（🟡加入观察）/ BREAKOUT_TRACK（🟢突破跟踪）/
RETEST_WATCH（🔵回踩重点观察）/ OVERHEATED（🟠结构有效，但已过热）/
DATA_BLOCKED（⚫数据不足，暂停判断）/ NO_ACTION（⚪暂无行动）。

## 3. Mapping Logic
- 源码：`src/lib/action.ts` → `deriveActionState(input: ActionInput): ActionState`
  （优先级：DATA_BLOCKED ＞ HARD_VETO ＞ ENVIRONMENT_BLOCK ＞ FAILED/INVALIDATED/MARKET_BLOCKED ＞
  OVERHEATED ＞ RETEST_WATCH ＞ BREAKOUT_TRACK ＞ NEAR/BUILDING ＞ NO_ACTION）。
- UI 入口：`actionInputFromSignal(signal, { asset, price, priceTs, forcedStatus })`（同文件），
  页面只 render，不写判定。
- Setup 分只决定是否 WATCH；Trigger 只表述结构完整度；实时输入无任何 outcome 字段（TEST 15）。

## 4. PEPE Case（实际输出，`deriveActionState` 直出）
- 输入：STRUCTURE_VETO + Setup 100 / Trigger 100 / Heat 0，现价 3.607e-6，
  本轮突破位 4.097e-6，结构失效位 3.6463e-6，episode age 408h。
- 输出：**🔴 当前淘汰** — "当前价格已经跌破结构失效位，本轮突破结构失效。
  本轮突破发生于约 408h 前，当前结构已经失效。"
- Reasons：✓BTC 允许 / ✗STRUCTURE_VETO 已触发 / ✗结构已失效 / ✗现价已低于结构失效位；
  Warning："Setup 100 / Trigger 100 为本轮历史突破评分，仅用于复盘……"；
  Next："系统识别到新的 Independent Breakout Episode → 重新进入观察或跟踪（不沿用旧 episode）"；
  `history.historicalOnly = true`，`episodeStatus` 明确等待新 episode。

## 5. DOGE Case（实际输出）
- 输入：RETESTING + ALLOW + 无否决，现价 0.0907，本轮突破位 0.0900，
  结构失效位 0.0896，当前下一压力 0.0953，Follow-through 100，Heat 低，age 52h。
- 输出：**🔵 回踩重点观察** — "本轮突破后的回踩结构仍然有效，这是当前值得重点观察的阶段。"
- Reasons 5×✓（环境/有效突破/守住突破区/未失效/无否决）；
  Next：守住 0.0900 → 保持有效 / 4H 收盘跌破 0.0896 → 失效 / 重破 0.0953 → 新阶段；
  全程无"买入/开仓/胜率"表述（TEST 断言覆盖 8 类禁用语）。

## 6. UI Changes
- 首页/详情顶部永远先渲染 ActionCard（Level 1 行动 → Level 2 关键价格 → Level 3 为什么/接下来观察），
  之后才是 Environment / 分层评分 / 条件清单。
- Risk → **Entry Heat · 追高/过热**（`0 / 100 · 低`格式 + tooltip，明确非全部交易风险）。
- 突破位 → **本轮突破位**；rolling 阻力 → **当前下一压力**；失效观察位 → **结构失效位**；
  突破距离 → **突破当根超越幅度**；新增 **当前距突破位**（两者禁止混用）。
- 结构失效后 Setup/Trigger/Follow 分区灰化 + "本轮历史突破评分，仅用于复盘"标签。
- Trigger tooltip："……不代表未来收益概率"；Setup tooltip：含 41%/30% 误报说明；
  Follow-through 显示 `HEALTHY · 100` / `PENDING` 状态优先，缺失不显示 0 分。
- 方法论新增「识别能力 vs 预测能力」「当前行动」两节，声明同步 M1–M4/M5/误报边界。

## 7. Tests
- `pnpm test`：**69/69 通过**（54 旧 + 15 新增 `src/lib/action.test.ts`），0 失败；
  `tsc --noEmit` 零错误；`eslint --quiet`（含全仓复查时）零告警。
- 15 项覆盖 §25 TEST 1–15（含 PEPE/DOGE 回归、禁用语扫描、historicalOnly、AND 外无关性）。

## 8. Quant Logic Changes
**本轮未修改底层量化策略。** 唯一参数类新增是展示分档
（Entry Heat 高≥70/中≥40、Follow-through HEALTHY≥60、其余为 WEAK），均为 display-only，
只决定文案颜色与状态词，不参与任何交易判定与回测，已在源码注释中声明。

## 9. Screenshot（真实浏览器验证，ORCA computer-use + Chrome）
- `docs/qa/ACTION_CARD_HOME.png`：首页实拍（OKX 在线 live 数据）。PEPE **🔴当前淘汰**
 （"408h 前……已经失效"，现价 3.6510e-6 / 本轮突破位 4.0970e-6 / 结构失效位 3.6463e-6 /
  当前下一压力 3.8790e-6），DOGE **🔵回踩重点观察**（现价 0.0913 / 本轮突破位 0.0900 /
  结构失效位 0.0896 / 当前下一压力 0.0953）——与 §29 验收场景逐字一致。
- `docs/qa/ACTION_CARD_LEVELS.png`：信息层级实拍。PEPE 历史评分区灰化
  （Setup 100 / Trigger 100 / Follow-through FAILED·55 / Entry Heat 0/100·低 +
  "本轮历史突破评分，仅用于复盘"），STRUCTURE_VETO 横幅紧随其后；
  DOGE 显示 Setup 65 / Trigger 突破结构完整度 60 / HEALTHY·100 / Entry Heat 0/100·低、
  本轮突破位 0.0900 / 突破收盘 0.0907 / 突破当根超越幅度 +0.84% / 突破量比 6.54x /
  突破 52h 前、"跟踪 EP-DOGE-002（episode age 52h）"、三条接下来观察。
- live 验证附带发现并已修复 1 个显示 bug：`nextConditions` 文案曾直接 `String(level)`，
  把 `rollingHigh*0.94` 的浮点伪影（0.08957259999999999）暴露给用户；
  已改为 6 位有效数字格式化（`action.ts: fmtNum`，纯展示修复，非策略改动），
  action 单测 + tsc + eslint 重新全绿。
- 注：验证用 Chrome 新标签页已保留在用户浏览器中（localhost:5000），可自行关闭；
  dev server 已停止，需预览请跑 `bash scripts/dev.sh`。

## 10. Remaining Limitations
- M1–M4 尚未证明具有样本外增量，M5 尚待新的 holdout 验证。
- OVERHEATED/WEAK 等展示分档未经回测，不得解读为预测信号。
- 当前沙箱无实时数据，线上需在 PRODUCTION_DATA_VALIDATED 后复验 ActionCard 的 live 路径。

## 11. 审查整改（docs/review/CODE_REVIEW.md §7 + docs/qa/BUGS.md）
本轮查收独立审查与 QA 台账后整改如下（`4d7c724` 之后，未改任何策略阈值/权重）：
- §2.1（Medium，合入前置）：REJECT 文案按否决种类分支——DATA_VETO 走"数据不足以判定结构"分支；
  环境 BLOCK（无失效态）走"环境禁止跟踪"分支；仅结构性否决/失效态保留"跌破失效位"表述。
  新增 action.test.ts TEST 16/17/18（BTC_VETO 无突破 / env BLOCK 无突破 / DATA_VETO）。
- BUG-001：条件清单 `4H 收盘突破 rolling 阻力` → `4H 收盘突破本轮突破位`
  （`engine.ts` + `config.ts` STATE_META 描述同步）；历史详情页"突破距离"→"突破当根超越幅度"。
- BUG-002：方法论导语"风险分"→ Entry Heat。
- BUG-003：报告 §8 WEAK 口径订正为"HEALTHY≥60、其余为 WEAK（display-only）"，与实现一致。
- §7.2.3：删除 `fmtNum`，价格文案统一走 `formatPrice`（与 KeyPrice 区同口径），
  新增 TEST 19（浮点伪影回归 + 双轨一致性断言）。
- §2.3：删除 `episode.ts` 两处 `BREAKOUT_TRIGGERED` 死赋值（保留态语义注释）；
  funding 缺失时 Entry Heat 显示"未知"而非"低"（`engine.ts`，分值口径不变）；
  `backtest.ts` 注释 + 本报告集注明 M4 实际增量仅 BTC/DATA veto；
  删除 `status` 中的死类型 `'partial'`（3 处类型声明，行为不变）；
  删除零引用的 V1 死代码 `src/lib/analysis.ts`（15 行再导出垫片）。
- STYLE-DEBT：SignalCard/AssetDetail 硬编码 hex 全部映射为 token
 （Trigger→`--btc`、Follow→`--radar`、Heat 高/中/低→`--bear/--warn/--bull`）。
- §7.2.4：两张截图移入 `docs/qa/`，报告引用同步。
- 未动事项（需所有者裁决，非本轮权限）：§2.2 AGENTS.md 约束字面冲突（研究层 normal/标签/回测指标
  vs"不设对照窗口/不输出胜率"）维持现状，报告中的 precision/successRate 未进任何信号 UI；
  QA INFO-002（`==` 边界）/INFO-003（`heldAbove=null` 处理）维持现状，含义已在 QA 清单备注。
