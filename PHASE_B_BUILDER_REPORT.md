# Phase B Builder 回告（Alert Center 报警中心｜禁 commit/push，未提交）

- HEAD：0639d86。工作区基线 = Phase A 未提交改动（期望 Bar 三态 + 15min 集中 grace + API candle 字段 + 三行分离）。
- 上轮残留 2 处未碰、未纳入本次 scope 评估：`M next-env.d.ts`（构建噪音）、`?? PRE_ALERT_PRODUCTION_CLOSEOUT.md`（前人文件）。
- 禁项自查：未新增策略 / Setup-Trigger 权重 / Follow 算法 / Env 阈值 / EntryHeat 阈值 / HardVeto / Rolling42 / Episode 判定 / Walkforward / MFE-MAE / M5 / holdout / 手机端专项 / 胜率包装。`config.ts`、`v2/engine.ts`、`action.ts`、`indicators.ts`、`state-machine.ts` 零改动（B-TEST22 源码级断言）。

## 1. 新增文件（4 新增 + 1 接线）

- `src/lib/alert-center.ts`（新建）：订阅/严重级别/文案/alertKey/去重/ACK/状态机/持续模式/Pattern/通道/历史 50/设置/存储键/能力边界，纯函数，无 DOM/Audio/网络。
- `src/lib/alert-sound.ts`（新建）：10 种 Web Audio 自生成声音 + 用户手势解锁 + 测试音 + 音量钳制，禁静默失败。
- `src/components/market/AlertCenter.tsx`（新建）：AlertCenterHost（60s 自轮询 overview，只消费现有 Action/Episode/Freshness）+ 横幅队列 + Modal + 历史/设置中心 + Tab 闪 + 系统通知(click 聚焦 #radar-live) + Esc 只停声 + AUTO 倒计时 + 测试报警。
- `src/lib/alert-center.test.ts`（新建）：B-TEST1~25。
- `src/app/layout.tsx`（接线 3 行）：挂载 `<AlertCenterHost/>` + `main#radar-live` 锚点（系统通知点击定位用）。其余 Phase A 文件零碰。

## 2. Gate 四件套（全 PASS，FAIL 即停口径）

- `pnpm test`：132/132 通过（旧 107：P0/Action/A-TEST10/事件回归 + 新增 B-TEST25）。
- `pnpm ts-check`：0 错误（中途 1 次 FAIL：sanitizeSettings 嵌套 Partial 类型，已修复后重跑通过）。
- `pnpm lint:build`：0 错误（quiet）。
- `pnpm exec next build`：成功（16 路由，与 Phase A 一致）。

## 3. B-TEST1~25 结果（25/25 PASS）

- B-TEST1 默认订阅：跟踪/回踩/淘汰/数据不足开、观察关、过热关。
- B-TEST2 只监听现有信号：NO_ACTION 永不报警。
- B-TEST3 状态变化才建：prev==cur 禁、无订阅禁。
- B-TEST4 alertKey = symbol+episodeId+actionState。
- B-TEST5 同键只建一个（刷新/轮询/重挂载禁重复）。
- B-TEST6 ACK 语义：同 key 禁再报，新 Episode 键不同。
- B-TEST7 UNTIL_ACK：TRIGGER→SHOW→ACTIVE→ACK；无 ESC 事件，Esc 不离 ACTIVE。
- B-TEST8 AUTO：10/30/60 + 倒计时 + 超时→AUTO_DISMISSED。
- B-TEST9 10 种声音：id/步骤签名 10/10 唯一。
- B-TEST10 音量钳制 + 默认 40 不大 + 默认声音可解析。
- B-TEST11 5 种 Pattern 齐备。
- B-TEST12 AUTO 循环不超关闭时间（maxSoundLoops 上限）。
- B-TEST13 5 表现通道。
- B-TEST14 设置 sanitize（非法秒数回退 30）。
- B-TEST15 能力边界：CAPABILITY_NOTE 明写无 Web Push + 关页停检。
- B-TEST16 文案：6 状态标题正文 + 价格位 + Freshness，禁买入/胜率/概率/必涨。
- B-TEST17 严重级别：INFO/WATCH/IMPORTANT/CRITICAL 全覆盖（REJECT=CRITICAL，DATA_BLOCKED=INFO）。
- B-TEST18 历史 50 条：11 字段 + darkReason，超限保最新。
- B-TEST19 队列堆叠禁覆盖（append）。
- B-TEST20 状态机全路径 + mount/误事件不推进（禁 mount 决定生命周期）。
- B-TEST21 禁未来数据（去注释源码无 mfe-mae/MFE/MAE/outcome/backtest/samples；记录无未来字段）。
- B-TEST22 量化禁项零触碰（阈值/权重/detectBreakout/walkForward/holdout 无引用；文案禁语表除外，见 B-TEST16）。
- B-TEST23 grace 沿用：报警层无新增 GRACE/STALE 阈值常量。
- B-TEST24 DARK 原因：DATA_BLOCKED 携带，普通 null，历史保留。
- B-TEST25 AUTO 同状态禁重报（历史/ACK 键命中即禁）。

## 4. Quant 审计

| 项 | Old | New | Reason | 是否改输出 |
|---|---|---|---|---|
| gracePeriod（CANDLE_FRESHNESS_GRACE_MS=15min） | Phase A 集中定义 | 沿用，无新增参数（B-TEST23 断言报警层无 GRACE/STALE 常量） | 报警只消费 freshness 结果，不重定新鲜度 | NONE（报警层不改输出） |
| 策略/阈值/权重/评分/HardVeto/Episode/Walkforward/M5 | — | 零改动（diff 无 `config.ts`/`v2/`/`action.ts`/`indicators.ts`/`state-machine.ts`） | Phase B 禁项 | NONE |

Quant 审计结论：**NONE**（grace 沿用，无新增参数；量化零改动）。

## 5. 是否可进复审

- 可进。Gate 四件套全绿，B-TEST25 全覆盖任务书 10 项要点，禁项零触碰（B-TEST21/22 源码级举证），接线仅 3 行（layout 挂载 + 锚点）。
- 待复审关注：系统通知需 HTTPS/localhost 权限实测；声音需真机点击初始化实测（自动播放限制各浏览器不同）；轮询 60s 间隔与服务端缓存的配合。
