# ALERT_CENTER_PRODUCTION_CLOSEOUT（Alert Center 生产收口）

> 记录时间（UTC+8）：2026-09-08 21:05–21:25（UTC 13:05–13:25）｜记录人：dispatched worker（task_0693787d3b0c）
> 生产基址：`https://pepe-doge-breakout-radar.vercel.app`
> 前提：生产已确认 bf2329f 内容在位（本轮以 `candle` 字段指纹复验确认）。
> 终态口径三选一：PASS_CANDIDATE / PARTIAL / BLOCKED（见§36）。
> 禁令遵守：未改线上配置（无 push、无 deploy、无 Vercel/域名/环境变量操作）；未做手机端新工作（无 CSS/布局改动）；真报警只观察自然发生，不伪造。

---

## §1 任务与禁令遵守

- 任务：生产复验 Freshness（三币现价/lastConfirmedOpenTs/lastConfirmedCloseTs/expected/candleLagBars/freshnessStatus）＋ Alert Center 生产 TEST ALERT 全链路 ＋ 页面/API 逐项 HTTP ＋ 研究指标未入 Alert ＋ 实时卡无胜率；生成本收口报告（业务仓根，36 节）；worker_done 回告§51共17项（见§36）。
- 禁令遵守：未改线上配置；未做手机端新工作；TEST 之外未伪造任何真实报警（生产本次双币 REJECT 存量态，无新增自然报警，属预期内，只观察）；未调阈值/权重/M5（bf2329f 量化文件零 diff，见§31）。
- 方法：页面/API 用 curl 实测；Action 结论用业务仓同版 `actionInputFromSignal` + `deriveActionState` + 生产 payload 经 tsx 实测推导（确定性映射）；浏览器内声音/Modal/闪烁等表现层以代码＋B-TEST 单测举证（无真机点击断言，见§35限制）。

---

## §2 仓库 · 分支 · 起止 HEAD · Commit · 状态

- 业务仓：`pepe-doge-breakout-radar-deepseek-v4-pro`，分支 `main`（与 `origin/main` 同步，无 ahead/behind）。
- 起止 HEAD（本轮零 commit，起止一致）：`bf2329fc2ccb7f45979e79c78f9a3b9e6ff8b1bf`
  `feat(radar): Alert Center报警中心+Freshness close语义修正（量化阈值权重零改动）`（2026-09-08 21:04:18 +0800）。
- 近端 commit 列表（`git log --oneline -5`）：
  - `bf2329f` feat(radar): Alert Center报警中心+Freshness close语义修正（量化阈值权重零改动）
  - `0639d86` feat(radar): 报警前可靠性收口 P0新鲜度三态+缺数据安全语义+P1方案A落字
  - `e55b0a6` docs(radar): 洁癖对齐（测试数73）
  - `c831f59` docs(radar): 存档4散文件 + 补.preview门牌
  - `e8b10cb` merge(main): 并入 f586d4a 文档同步V2+清理V1残留
- `git status --short`：`M next-env.d.ts` 一项（`pnpm next build` 自动改写产物，惯例不计业务改动）＋ `?? ALERT_CENTER_PRODUCTION_CLOSEOUT.md`（本报告）。其余 clean。
- 本轮工作树业务改动：零（只新增本报告文件）。

---

## §3 Phase A 修改逐项（bf2329f 内含，来自 PHASE_A_BUILDER_REPORT）

1. `src/lib/time.ts`：统一 open/close 语义注释；新增 `candleCloseTs`、`current4HOpenTs`、`expectedLastConfirmedOpenTs`。
2. `src/lib/freshness.ts`：集中 `CANDLE_FRESHNESS_GRACE_MS`；新增 `assessCandleFreshness`、`deriveCandleOverviewFreshness`、`candleStatusToFeed`、`formatAgeCn`、`candleMainCopy`、`priceMainCopy`；`deriveOverviewFreshness` 改写为 K 线期望 Bar 对比＋现价 8h 年龄分离判定；旧 `lastConfirmedTs` 保留（契约兼容）。
3. `src/lib/market-service.ts`：`MarketOverview` 新增 `candle: CandleOverviewFreshness`；`lastConfirmedTs` 注释标 open 语义。
4. `src/lib/market-client.ts`：`until` 注释标 openTs 语义（逻辑零改）。
5. `src/app/api/market/overview/route.ts`：输出 `candle{current4HOpenTs, expectedLastConfirmedOpenTs/CloseTs, lastConfirmedOpenTs/CloseTs(per coin), candleLagBars(per coin), freshnessStatus, staleReason}`。
6. `src/lib/format.ts`：新增 `formatClock`。
7. `src/components/market/DataStatus.tsx`：新增 `CandleFreshnessBlock`；`SourceFreshnessRow` K 线三路改期望 Bar 口径。
8. `src/components/market/LiveRadar.tsx`：接入三行块（PEPE/DOGE）＋头部 `最近4H收盘<close>·K线<STATUS>`。
9. `src/components/market/AssetDetail.tsx`：接入单币三行块；K 线行与图表脚注改 close 口径区间展示。
10. 新增 `src/lib/candle-freshness.test.ts`：A-TEST1~10。

---

## §4 close 语义（Phase A 全仓唯一口径）

- `candleOpenTs` 是区间起点，K 线覆盖 `[openTs, openTs+4H)`；confirmed candle 的 `candleCloseTs = openTs + 4H`（`time.ts:70`）。
- 禁止把 openTs 直解为「最后更新时间」：一切「X 前收盘」展示必须用 `now - candleCloseTs`，否则虚增 4h（`freshness.ts:9-17` 注释冻结）。
- 形成中 K 线（`current4HOpenTs = floorTo4H(now)`）未收盘，只展示不确认突破、不参与新鲜度 actual。
- 生产验证：本轮 `lastConfirmedCloseTs` 三币 `1788868800000` = `lastConfirmedOpenTs 1788854400000 + 4H`，口径一致（见§28）。

---

## §5 三态（LIVE / STALE / UNAVAILABLE）

- K 线链路走期望收盘 Bar 对比（`assessCandleFreshness`）：actual 缺失/非法 → UNAVAILABLE（`confirmed_candle_missing`）；actual ≥ expected → LIVE；落后 lagBars≥1 且宽限不覆盖 → STALE（`latest_confirmed_candle_behind_expected_bar`）。
- 三币合并（`deriveCandleOverviewFreshness`）：任一 UNAVAILABLE → UNAVAILABLE；否则任一 STALE → STALE；否则 LIVE。
- 现价链路独立 8h 年龄判定（`assessFeedFreshness`，`CANDLE_STALE_AFTER_MS=8h`）；overview 取最差（unavailable > stale > ok）。
- STALE/UNAVAILABLE 调用方必须走 DATA_BLOCKED，禁沿用 BREAKOUT_TRACK/RETEST_WATCH/WATCH（`action.ts` dataStatus 门控）。

---

## §6 grace（15min 集中唯一来源）

- `CANDLE_FRESHNESS_GRACE_MS = 15min`，`freshness.ts:69` 集中唯一定义；报警层无新增 GRACE/STALE 常量（B-TEST23 断言，grep 本轮复核零命中）。
- 语义：仅覆盖「只缺刚收盘那一根」（lagBars==1）且 `now - expectedClose <= grace` → LIVE；lag≥2 照判 STALE（宽限不包庇）。
- Reason：OKX confirm 翻转＋服务端 60s 缓存＋轮询间隔，收盘数据到达有分钟级延迟。
- Quant 影响：非交易阈值/权重，不参与评分与回测；仅新鲜度展示与 DATA_BLOCKED 门控（收盘后宽限期内缺 Bar 由 STALE→LIVE）。

---

## §7 API 字段（`candle` 对象，bf2329f 内容指纹）

- `current4HOpenTs`、`expectedLastConfirmedOpenTs/CloseTs`、`lastConfirmedOpenTs{PEPE,DOGE,BTC}`、`lastConfirmedCloseTs{PEPE,DOGE,BTC}`、`candleLagBars{PEPE,DOGE,BTC}`、`freshnessStatus`、`staleReason`（编码：LIVE→null / STALE→`latest_confirmed_candle_behind_expected_bar` / UNAVAILABLE→`confirmed_candle_missing`）。
- 旧契约不变：`freshness`、`fundingTs`、`status`、`lastConfirmedTs`、`prices` 全部保留（前端回退分支保留，加性变更）。
- 生产在位验证：本轮 overview 实测 `candle` 全字段在位（0639d86 及之前无此对象）⇒ 生产内容 = bf2329f，高置信（见§27）。

---

## §8 UI 前后（Phase A 展示层）

- 前（0639d86）：`SourceFreshnessRow` 8 路行沿用旧 8h 年龄口径；K 线行存在 openTs 直解偏差风险；LiveRadar 头部无 close 口径状态。
- 后（bf2329f）：`CandleFreshnessBlock` 现价/K线/形成中三行分离；`SourceFreshnessRow` K 线三路改期望 Bar 口径＋统一主口径（`candleMainCopy`：`K线X·STATUS·最近收盘X前`，closeTs 计时）；LiveRadar 头部 `最近4H收盘<close>·K线<STATUS>`；AssetDetail 单币三行块＋图表脚注 close 口径区间展示。
- live 时 `最后有效更新`行按设计隐藏；非 ok 时显示，门控语义不变。

---

## §9 A-TEST10 结果（10/10 PASS，`candle-freshness.test.ts`，含于 132）

- A-TEST1：18:20/actual12:00 → LIVE（断言禁含“6小时”，close 口径）。
- A-TEST2：12:00/actual08:00 → LIVE。
- A-TEST3：actual08:00 落后期望 lag1 且超宽限 → STALE → DATA_BLOCKED，且 code ∉ {BREAKOUT_TRACK, RETEST_WATCH, WATCH}，breakoutLevel=null。
- A-TEST4：形成中 16:00 `isCandleClosed=false`；confirmed 过滤后 until=12:00 ≠ intraday，LIVE。
- A-TEST5：12:05/actual04:00（lag1 宽限期内）→ LIVE，staleReason null。
- A-TEST6：20:00/actual08:00 lag2 → STALE。
- A-TEST7：null/NaN/-1/Infinity → UNAVAILABLE ＋ `confirmed_candle_missing` → DATA_BLOCKED。
- A-TEST8：ticker 新鲜＋K 线 STALE → overview stale → DATA_BLOCKED。
- A-TEST9：K 线 LIVE＋funding 缺失 → risk DATA_UNAVAILABLE ＋ EntryHeat 未知。
- A-TEST10：三币合并（一币 STALE → 整体 STALE）；主口径均为 closeTs 计时。

---

## §10 Alert 架构总览（Phase B，bf2329f 内含）

- 三层：纯函数逻辑层 `src/lib/alert-center.ts`（订阅/级别/文案/key/去重/ACK/状态机/模式/Pattern/通道/历史/设置/存储键/能力边界，无 DOM/Audio/网络）＋ 声音层 `src/lib/alert-sound.ts`（10 种 Web Audio 自生成＋手势解锁＋音量钳制）＋ UI 层 `src/components/market/AlertCenter.tsx`（AlertCenterHost 60s 轮询 overview，只消费现有 Action/Episode/Freshness；横幅队列＋Modal＋历史/设置中心＋Tab 闪＋系统通知＋Esc 只停声＋AUTO 倒计时＋测试报警）。
- 接线仅 3 行：`src/app/layout.tsx` 挂载 `<AlertCenterHost/>` ＋ `main#radar-live` 锚点（系统通知点击定位用）。
- 新增 `src/lib/alert-center.test.ts`：B-TEST1~25（见§25）。
- 生产 SSR 首页实测含 `AlertCenter`＋`alert`＋`radar-live` 标记（客户端浮层/TEST 按钮经水合挂载，SSR 无浮层属预期）。

---

## §11 触发源（R1：只监听现有信号，不创造新信号）

- 输入：`actionInputFromSignal(sig, {asset, price, priceTs, forcedStatus, staleReason})` → `deriveActionState`（与 ActionCard 同一函数），episodeId 取自现有 Episode 信号（`sig.breakout.episodeId`），价格位取自 `sig.breakout.level / sig.keyLevels`（无则 null，写“未知（待确认）”，禁编数字）。
- 轮询失败不建 Alert（无信号不报警）；`masterEnabled` 关或币种关则只快照 prev，不建。
- `NO_ACTION` 永不报警（`isSubscribable` 过滤，B-TEST2）。
- 禁读：MFE/MAE/Outcome/backtest/samples/event-metrics（B-TEST21 源码级断言；本轮 grep 复核零命中，见§32）。

---

## §12 去重（R2/R3：状态变化才建，同键只建一个）

- `alertKey = symbol|episodeId|actionState`（`buildAlertKey`，B-TEST4）。
- 建条件四连（`shouldCreateAlert`）：可订阅内＋已订阅＋`prev != cur`（B-TEST3）＋不在 existingKeys（刷新/轮询/重挂载禁重复，B-TEST5）＋不在 ackedKeys（B-TEST6）。
- UI 层 existingKeys = seenKeys(500 上限，防历史截断丢键后重报)＋acked＋history keys＋active keys 四源合并。
- AUTO 同状态禁重报：历史/ACK 键命中即禁（B-TEST25）。

---

## §13 Episode 键（Independent Episode 去重延续）

- 同 episode＋同 state 共享同一 alertKey；ACK 后同键禁再报（R4）；新 Episode（键不同）允许再报（B-TEST6）。
- 生产现状：PEPE `EP-PEPE-001`、DOGE `EP-DOGE-002`（overview `breakout.episodeId`；双币 INVALIDATED 存量态，prev==cur 时不建新 Alert，属预期）。
- 突破位/失效位来自现有 Episode 信号，无数据诚实写未知（C2）。

---

## §14 ACK 语义（R4/R5）

- 状态机：`IDLE --TRIGGER--> TRIGGERED --SHOW--> ACTIVE --ACK--> ACKNOWLEDGED --EXPIRE--> EXPIRED`；`ACTIVE --AUTO_DISMISS_TIMEOUT--> AUTO_DISMISSED`（可再 ACK）；任何态 `--RESET--> IDLE` 仅测试/新 episode 用（`nextAlertLifecycle`，B-TEST20 全路径＋mount/误事件不推进）。
- ACK 持久化 localStorage（`radar.alert.acked.v1`）；同 episode+state ACK 后禁再报；历史记录 lifecycle 同步为 ACKNOWLEDGED。
- Esc 禁当 ACK：只暂停声音＋取消排队鸣响，保持 ACTIVE（B-TEST7；UI `onKey` 实现）。

---

## §15 双模式（UNTIL_ACK / AUTO_DISMISS）

- `DismissMode = UNTIL_ACK（需手动确认） | AUTO_DISMISS（倒计时自动关闭）`；默认 `AUTO_DISMISS 30s`。
- UNTIL_ACK：`TRIGGER→SHOW→ACTIVE→ACK`，无 ESC 事件，Esc 不离 ACTIVE；CONTINUOUS pattern 可真持续到 ACK（1200ms 间隔，ACK/超时/Esc 取消）。
- AUTO_DISMISS：10/30/60s 三档（非法回退 30，B-TEST14）＋每秒倒计时显示（`countdownLeft`）＋超时停声关层但留历史（lifecycle→AUTO_DISMISSED）＋同状态禁重报。
- AUTO 下循环不超关闭时间：`maxSoundLoops = ceil(autoSecs/singleLoopSecs)` 上限（B-TEST12）。

---

## §16 10 声逐项（Web Audio 自生成，无外部文件/网络）

| # | id | 中文 | 步骤签名 |
|---|---|---|---|
| 1 | chime-soft（默认） | 柔和上行 | 660/sine/220ms＋880/sine/260ms，loop 0.6s |
| 2 | chime-double | 双音确认 | 523×2/sine/180ms，loop 0.5s |
| 3 | pulse-low | 低频脉冲 | 220/triangle/300ms，loop 0.4s |
| 4 | pulse-high | 高频脉冲 | 1175/triangle/160ms，loop 0.3s |
| 5 | sweep-up | 上扫 | 440→660→880/sawtooth，loop 0.6s |
| 6 | sweep-down | 下扫 | 880→660→440/sawtooth，loop 0.6s |
| 7 | triple-beep | 三连音 | 740×3/square/120ms，loop 0.5s |
| 8 | soft-block | 闷音块 | 330/sine/400ms，loop 0.5s |
| 9 | alert-stair | 阶梯三级 | 392→523→659/triangle，loop 0.6s |
| 10 | alert-long | 长鸣提醒 | 988/sine/500ms，loop 0.6s |

- 10/10 id＋步骤签名唯一（B-TEST9）；音量钳制＋默认 40 不大＋默认声音可解析（B-TEST10）；选中即试听、切换先停旧声、保存明确“已生效”反馈、停止试听/停止当前声音共用 `stopAlertSound`。
- 试听结论：代码＋单测级有据（B-TEST9/10 PASS）；真机人耳试听未做（无真机断言，见§35）。

---

## §17 5 Pattern 逐项

- ONCE（响一次）：`[0]`。
- DOUBLE（响两次，默认）：`[0, 600]`。
- TRIPLE（响三次）：`[0, 600, 1200]`。
- INTERVAL（间隔重复）：`[0, gap, gap*2]`（默认 gap 1200ms）。
- CONTINUOUS_UNTIL_ACK（持续到确认）：首响即播＋`setInterval(1200ms)` 真持续，直到 ACK/超时/Esc 取消（C3）。
- 5 种齐备（B-TEST11）；有限 Pattern 在 AUTO 下由 timeout 截断，不超关闭时间（B-TEST12）。

---

## §18 5＋ 提醒方式（多选 5 通道，默认 system 关其余开）

- modal（弹窗）：仅首个 ACTIVE，`role=alertdialog`，ACK/暂停声音按钮＋Esc 说明＋CAPABILITY_NOTE。
- banner（横幅）：右上堆叠队列＋倒计时＋ACK/暂停声音/停止当前声音＋TEST 虚线隔离标。
- system（系统通知，默认关）：granted 才发，`tag=alertKey`，click 聚焦 `#radar-live`。
- tabflash（标签页闪烁）：有 ACTIVE 才 1s 交替 `【提醒 N】` 标题；无 ACTIVE 恢复。
- cardpulse（卡片脉冲）：横幅 `animate-pulse` 开关。
- 5 通道齐备（B-TEST13）；设置 sanitize 非法回退（B-TEST14）。

---

## §19 通知权限（四态＋DENIED 指引禁反复请求）

- 四态：granted / denied / default / unsupported（无 Notification 即 unsupported）。
- DENIED：只置状态＋指引到浏览器地址栏手动允许，本页不再反复弹窗（`requestNotify` 实现）。
- granted 才 `new Notification(title, {body, tag})`；default 按需 `requestPermission` 一次。
- 待真机实测：HTTPS/localhost 权限弹窗行为（Phase B 遗留，见§35）。

---

## §20 autoplay（用户手势解锁＋测试音＋禁静默失败）

- 启用声音必须用户点击初始化 AudioContext＋播放测试音（`ensureAudioUnlocked`，短促单音固定小音量 20）。
- 未解锁时 `playAlertSound` 返回 `{played:false, reason:'locked'}`，UI 显示“声音被浏览器拦截，点击恢复”（禁静默失败）。
- muted 或 volume≤0 返回 `muted`；unsupported/no-window/suspended/error 均有明确 reason。
- 各浏览器自动播放限制差异待真机实测（遗留，见§35）。

---

## §21 历史（50 条，11 字段＋DARK 原因）

- 11 字段：alertKey / coin / episodeId / actionCode / severity / title / body / price / freshnessLabel / createdAt / lifecycle ＋ darkReason（仅 DATA_BLOCKED/REJECT 数据分支有值，其余 null，B-TEST24）。
- 上限 50 条，超限保最新；同 alertKey 已在历史中直接返回原列表（不重复 append，不消耗上限，B-TEST18）。
- TEST 隔离：`isTestAlertRecord`（键/episodeId/标题三者任一命中）→ `pushHistory` 直接拒收，禁写真实历史（B-TEST 覆盖＋组件三处隔离注释）。
- 严重级别固定映射：WATCH/OVERHEATED→WATCH，DATA_BLOCKED→INFO，BREAKOUT_TRACK/RETEST_WATCH→IMPORTANT，REJECT→CRITICAL（B-TEST17）。

---

## §22 队列（堆叠禁覆盖，R6）

- `setActive(list => [...list, withLife])` append；横幅按 ACTIVE 全量堆叠渲染，无覆盖逻辑（B-TEST19）。
- 排队鸣响注册表（alertKey → timeout/interval 句柄）：Esc/ACK/超时/停止键/卸载可取消；CONTINUOUS 用 interval，其余用 timeouts。
- 卸载时清理全部排队＋`stopAlertSound`（禁残留）。

---

## §23 刷新恢复（R5：mount 只恢复，不决定新事件）

- 持久化四键：settings（`radar.alert.settings.v1`）＋acked（`radar.alert.acked.v1`）＋history（`radar.alert.history.v1`，截断 50）＋active 快照（`.active`，仅真实 ACTIVE，preview 不持久化）＋seenKeys（`.seenKeys`，500 上限）。
- 恢复：sanitize 设置；seen = seen＋acked＋history keys 去重截断 500；active 只恢复真实 ACTIVE（`!preview`），soundPaused 置 false；历史遗留 preview 不恢复。
- 跨刷新同状态禁重报由 seen＋acked＋history keys 联合保证。

---

## §24 关页四边界（诚实声明，无 Web Push）

1. 关页停检：`CAPABILITY_NOTE` 明写“提醒只在页面打开时检查（随前端轮询触发），无 Web Push；页面关闭或浏览器退出后停止检查，历史与 ACK 保留在本地”（B-TEST15；Modal＋设置中心双处展示）。
2. 刷新恢复（见§23）：ACTIVE 恢复显示，声音需点击恢复（Modal 文案明示）。
3. 卸载清理：unmount effect 清空全部排队 timeout/interval＋`stopAlertSound`，禁残留鸣响。
4. 测试隔离不恢复不持久化：preview 记录禁写 active 快照、禁恢复、ACK/超时只关层禁写真实历史（`ack`＋AUTO 超时检查双处隔离分支）。

---

## §25 B-TEST25 结果（25/25 PASS，`alert-center.test.ts`，含于 132）

- B-TEST1 默认订阅（跟踪/回踩/淘汰/数据不足开，观察关，过热关）。B-TEST2 NO_ACTION 永不报警。B-TEST3 状态变化才建。B-TEST4 key＝symbol+episodeId+actionState。B-TEST5 同键只建一个。B-TEST6 ACK 语义（新 Episode 键不同可再报）。B-TEST7 UNTIL_ACK（Esc 不离 ACTIVE）。B-TEST8 AUTO（10/30/60＋倒计时＋超时→AUTO_DISMISSED）。B-TEST9 10 声唯一。B-TEST10 音量钳制＋默认 40。B-TEST11 5 Pattern 齐备。B-TEST12 循环不超关闭时间。B-TEST13 5 通道。B-TEST14 sanitize 回退。B-TEST15 能力边界（无 Web Push＋关页停检）。B-TEST16 文案（6 状态＋价格位＋Freshness，禁买入/胜率/概率/必涨）。B-TEST17 严重级别全覆盖。B-TEST18 历史 50 条。B-TEST19 队列堆叠。B-TEST20 状态机全路径＋mount 不推进。B-TEST21 禁未来数据。B-TEST22 量化零触碰。B-TEST23 grace 沿用（报警层无新增常量）。B-TEST24 DARK 原因。B-TEST25 AUTO 同状态禁重报。

---

## §26 四件套数字（本轮实测，workdir＝HEAD＋本报告未跟踪文件）

| 项 | 命令 | 数字 | exit |
|---|---|---|---|
| 单测 | `pnpm test` | **132/132 通过，0 失败**（旧 107：P0/Action/A-TEST10/事件回归＋新增 B-TEST25；duration ~314ms） | 0 |
| 类型 | `pnpm ts-check` | **0 错误** | 0 |
| Lint | `pnpm lint:build` | **0 告警** | 0 |
| 生产构建 | `pnpm exec next build`（Next 16.1.1 Turbopack） | **成功**；16 路由：`/` `/api/history` `/api/history/[id]` `/api/market/{candles,funding,health,overview}` `/api/similarity` `/api/similarity/current` `/asset/[coin]`（pepe/doge SSG）`/history` `/history/[id]` `/methodology` `/robots.txt` `/similarity` `/_not-found` | 0 |

- 构建注记：首轮因 `.next/build` 残留目录报 ENOTEMPTY（瞬时文件系统问题，非代码问题）；清理后重跑成功。`M next-env.d.ts` 系构建产物，惯例不计。

---

## §27 部署 URL＋SHA＋时间

| 项 | 值 |
|---|---|
| 生产 URL | `https://pepe-doge-breakout-radar.vercel.app` |
| 部署内容指纹 | `candle` 对象全字段在位（0639d86 及之前无此对象，见 PRE_ALERT§12 反向铁证）⇒ 生产内容 = bf2329f，高置信推断 |
| 生产 serverTime（health 实测） | `2026-09-08T13:10:37.837Z`，`region:hnd1`，`node:v24.19.0`，`runtime:vercel:production`，`durationMs:0` |
| 精确 Deployment SHA | **UNVERIFIED**（无 Vercel 控制台访问权限；以上为内容指纹推断，非控制台 SHA） |
| 本轮抓取窗口 | overview `generatedAt` 1788873037318 ＝ 2026-09-08 21:10:37 ＋08 |

---

## §28 三币生产 Freshness（本轮 21:10 ＋08 实测，`generatedAt` 1788873037318）

- 总览：`freshness{status:ok, lastUpdatedTs:1788868800000, reason:null}`；`candle{freshnessStatus:LIVE, staleReason:null, candleLagBars:{PEPE:0,DOGE:0,BTC:0}}`；`status:live`。
- 时间对齐：`current4HOpenTs` 1788868800000（20:00 ＋08）＝ `expectedLastConfirmedCloseTs`；`expectedLastConfirmedOpenTs` 1788854400000（16:00 ＋08）＝ 三币 `lastConfirmedOpenTs`（全对齐，lag 0）；`lastConfirmedCloseTs` 三币同值 1788868800000（20:00 ＋08，＝open＋4H，close 口径一致）。
- 现价：PEPE `3.623e-06` @1788873025470（龄 38.3s）；DOGE `0.08927` @1788873025666（龄 38.1s）；BTC `78434.5` @1788873025655（龄 38.1s）——三币现价龄均 ＜60s，新鲜。
- fundingTs：PEPE/DOGE 同值 1788854400002（16:00:00.002 ＋08），`fundingProvider:binance`。
- 双币推导（同版 tsx 实测）：PEPE REJECT（🔴当前淘汰，INVALIDATED＋STRUCTURE_VETO，420h，dist -11.57%）；DOGE REJECT（🔴当前淘汰，INVALIDATED＋STRUCTURE_VETO，64h，dist -0.76%，ticker 已跌破失效位 0.0895726）。BTC 环境：range，closeAboveEma100 true，hardBreakdown false，24h 回撤 -1.87%。

---

## §29 生产 TEST ALERT 验证（全链路，标 TEST，真报警只观察）

| 环节 | 生产/代码证据 | 判定 |
|---|---|---|
| 入口 | 设置中心「发送测试报警」按钮（`onSendTest={sendTest}`，SettingsPanel:686）＋生产 SSR 含 AlertCenter 挂载（§10） | 在位（代码级；SSR 浮层经水合挂载属预期） |
| 标 TEST | 标题 `PEPE · 测试报警（不代表真实信号）`＋浮层 `TEST·隔离预览（不入历史、不影响真实状态）` 虚线标（AlertCenter.tsx:443/473） | PASS（代码级） |
| 声音 | `playAlertSound(selectedSoundId, volume, muted)` 按当前设置发声；未解锁显示“点击恢复” | PASS（代码＋B-TEST9/10；真机人耳未验，见§35） |
| Modal | 首个 ACTIVE 即弹 `role=alertdialog`（测试 preview 同样进 active 队列，modal/横幅双显） | PASS（代码级） |
| 定时关闭 | AUTO 模式倒计时 `countdownLeft`＋超时关层；UNTIL_ACK 保持（`autoSecs` null 不显示倒计时） | PASS（代码＋B-TEST8） |
| UNTIL_ACK | Esc 只暂停声音不离 ACTIVE；ACK 才确认（preview ACK 只关层，§14） | PASS（代码＋B-TEST7） |
| 通知 Tab 闪＋卡片脉冲 | tabflash（title 1s 交替）＋cardpulse（`animate-pulse`）按 channels 开关；preview 同等享受表现层 | PASS（代码级） |
| ACK | 横幅/Modal 双处「知道了（ACK）」；preview ACK 禁写 acked/历史（AlertCenter.tsx:353-367） | PASS（代码级） |
| 历史 | `pushHistory` 拒收测试记录；超时检查过滤 preview；active 快照过滤 preview（§21/§24） | PASS（代码＋单测） |
| 真报警观察 | 生产本次双币存量 REJECT（prev==cur，无新增自然报警）；未伪造任何真实报警 | 如实记录（预期内） |

---

## §30 真报警观察声明（不伪造）

- 生产本轮双币均为存量 INVALIDATED＋STRUCTURE_VETO（REJECT），无状态变化 ⇒ 按 R2 不应产生新真实 Alert，观察到“无新报警”即符合设计。
- 未点击生产站任何真实 ACK/订阅/声音开关；未构造 stale payload；未断数据源。TEST 之外零伪造。

---

## §31 Quant 审计

**NONE**——bf2329f 内无任何量化改动：`git show HEAD --stat` 中 `config.ts` / `v2/` / `action.ts` / `indicators.ts` / `state-machine.ts` / `breakout.ts` / 回测阈值权重零命中（本轮 grep 复核空）；B-TEST22 源码级断言阈值/权重/detectBreakout/walkForward/holdout 无引用（文案禁语表除外）；B-TEST23 断言报警层无 GRACE/STALE 常量；grace 沿用 Phase A 集中定义（见§6）。无 Old/New/Reason/Impact/重测条目。

---

## §32 研究隔离确认（研究指标未入 Alert）

- 报警三文件 grep `mfe-mae|MFE|MAE|outcome|backtest|samples|event-metrics|walkForward|holdout|detectBreakout`：仅 `alert-center.ts:5-7` 禁令注释本身命中，实现零引用（B-TEST21 同口径）。
- 文案禁语 `买入/卖出/开仓/胜率/概率/必涨/必跌/保证/稳赚/全仓/加仓`：实现文案零命中（B-TEST16 逐条断言；`BANNED_COPY_WORDS` 表除外）。
- 方法论方案A生产在位（`/methodology` curl 全文命中：方案A/研究指标/不进入 ActionCard/不包装成胜率/不构成收益承诺/误报率/Precision/Recall，107KB）。
- Alert 历史 11 字段无未来字段；Episode 键只用现有点位信号。

---

## §33 页面/API 逐项 HTTP（本轮 21:05–21:15 ＋08 实测）

| # | 对象 | 实测 | 判定 |
|---|---|---|---|
| 1 | `/` | 200（59,680B；SSR 含 AlertCenter＋radar-live 标记） | PASS |
| 2 | `/asset/pepe` | 200 | PASS |
| 3 | `/asset/doge` | 200 | PASS |
| 4 | `/methodology` | 200（107,023B；方案A逐字在位，见§32） | PASS |
| 5 | `/history` | 200 | PASS |
| 6 | `/similarity` | 200 | PASS |
| 7 | `/api/market/overview` | 200 `{ok:true,status:live}`，candle 全字段在位（见§28） | PASS |
| 8 | `/api/market/candles?coin=PEPE&bar=4H` | 200 `{ok:true,source:live,provider:okx}` | PASS |
| 9 | `/api/market/candles?coin=DOGE&bar=4H` | 200 `{ok:true,source:live,provider:okx}` | PASS |
| 10 | `/api/market/funding?coin=PEPE` | 200 `{ok:true,source:live,provider:binance}` | PASS |
| 11 | `/api/market/funding?coin=DOGE` | 200 `{ok:true,source:live,provider:binance}` | PASS |
| 12 | `/api/market/health` | 200 `summary:{okx:ok,binance:ok,funding:ok}`（见§27） | PASS |
| 13 | `/api/history` | 200（21 事件，纯本地） | PASS |
| 14 | `/api/similarity/current?coin=PEPE` | 200 `{ok:true,status:live}` | PASS |
| 15 | `/api/similarity/current?coin=DOGE` | 200 `{ok:true,status:live}` | PASS |
| 16 | 刷新一致性 | 三币 lastConfirmed 同值＋close＝open＋4H；现价龄 ＜60s；expected 对齐 lag 0 | PASS（新鲜） |

---

## §34 实时卡无胜率

- 组件＋逻辑 grep `胜率|准确率|假突破概率`：仅 `action.ts:8` 禁令注释与 `alert-center.ts` 禁令注释/禁语表命中，实现文案零命中（本轮复核输出见证据链）。
- 双币生产推导输出（§28）含行动＋价格＋证据（reasons/nextConditions/episodeStatus/dataFreshness），无概率化收益表述。
- B-TEST16 对 6 状态文案逐条断言禁语（买入/胜率/概率/必涨类）。

---

## §35 限制

1. 精确 Deployment SHA 未经 Vercel 控制台核对，记 UNVERIFIED；部署内容＝bf2329f 为 `candle` 对象内容指纹高置信推断。
2. 表现层（声音人耳/Modal 目视/Tab 闪/系统通知弹窗/autoplay 各浏览器差异）为代码＋单测级举证，未做真机浏览器点击断言；系统通知 HTTPS 权限与音频自动播放限制待真机实测（Phase B 已知遗留）。
3. 生产本次全 live，三态降级分支未触发（预期内）；STALE→BLOCKED 与 UNAVAILABLE→BLOCKED 维持 PRE_ALERT§6 模拟结论＋A-TEST3/7 单测 PASS。
4. 生产本次无新增自然真实报警（存量 REJECT，prev==cur）；Alert 真实触发路径为代码＋B-TEST 举证，未在生产构造验证。
5. DOGE ticker（0.08927）现已跌破失效位（与 PRE_ALERT 时 ticker 高于失效位不同，行情自然演变）；否决依据仍为 4H 收盘结构＋STRUCTURE_VETO，映射符合代码。
6. API 原始 `invalidation` 浮点伪影（`0.08957259999999999`）维持现状（UI 层 `formatPrice` 已屏蔽，只列不修；PRE_ALERT§15 遗留延续）。
7. `next-env.d.ts` 脏改系构建产物，结论不受影响。

---

## §36 终态＋§51 回告 17 项

终态（三选一）：**PASS_CANDIDATE**——生产 bf2329f 内容在位（candle 指纹为证），6 页＋9 API 全 200，LIVE 正常行情，双币 REJECT（INVALIDATED＋STRUCTURE_VETO，同版 tsx 复现：PEPE 420h / DOGE 64h），方案A文案在位，实时卡无胜率，研究隔离成立（B-TEST21/22），TEST ALERT 全链路代码级在位＋隔离成立，真报警零伪造，四件套全绿（132/132、ts 0、lint 0、build 成功），Quant 审计 NONE；遗留仅 UNVERIFIED SHA、真机表现层未验与未触发分支（属预期内限制，不构成 BLOCK）。

§51 回告 17 项：①报告路径 `pepe-doge-breakout-radar-deepseek-v4-pro/ALERT_CENTER_PRODUCTION_CLOSEOUT.md`（本文件，业务仓根）；②Ending HEAD `bf2329f`（`bf2329fc2ccb7f45979e79c78f9a3b9e6ff8b1bf`，main）；③status：clean（仅 `M next-env.d.ts` 构建产物＋本报告未跟踪）；④URL `https://pepe-doge-breakout-radar.vercel.app`；⑤SHA：内容指纹＝bf2329f，精确 SHA **UNVERIFIED**；⑥测试数 `pnpm test` **132/132**（A-TEST10＋B-TEST25 含内）；⑦三币 freshness：PEPE/DOGE/BTC 现价龄 38s 级＋lastConfirmedOpen 三币 16:00＋08／Close 三币 20:00＋08／expected 对齐／lag 0／LIVE；⑧Alert 状态：在位（SSR 标记＋60s 轮询＋去重/ACK/双模式代码级全通）；⑨10 声试听：10/10 代码＋单测有据（真机人耳未验）；⑩5 Pattern：ONCE/DOUBLE/TRIPLE/INTERVAL/CONTINUOUS_UNTIL_ACK 齐备；⑪UNTIL_ACK：Esc 不离 ACTIVE＋ACK 确认，PASS（代码＋B-TEST7）；⑫AUTO_DISMISS：10/30/60＋倒计时＋超时留历史，PASS（代码＋B-TEST8）；⑬生产 TEST ALERT：入口/标 TEST/声音/Modal/定时关闭/UNTIL_ACK/Tab 闪卡片脉冲/ACK/历史隔离全链路在位，真报警零伪造；⑭Quant：**NONE**；⑮研究隔离：成立（未入 Alert，方案A在位）；⑯实时卡无胜率：PASS；⑰Final Status：**PASS_CANDIDATE**。
