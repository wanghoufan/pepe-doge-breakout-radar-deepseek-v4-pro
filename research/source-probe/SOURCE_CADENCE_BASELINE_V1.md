# SOURCE_CADENCE_BASELINE_V1（v1.0-FROZEN）

> 依据冻结协议 §6-P0.0：P0 建设第一步非评测 probe 的连续观测输出。
> 本文件冻结六项：`collector_poll` / `expected_source_update` / `heartbeat` /
> `stale_after` / `unavailable_after` / `recovery`（按 exchange×field 独立）。
> **状态：v1.0-FROZEN**——基于 2026-09-09T16:01:26Z–2026-09-10T18:59:31Z
> 约 27h 常驻观测（1619–1620 cycles，0 缺口）转正。
> 仍标 `PROVISIONAL-UNVERIFIED` / `UNMAPPED` 的单项**不得代入判定**（见 §7 limitation）。
> 冻结前 §6-0 表中 `cadence_*` 绝对值未定状态即日起解除，但仅 FROZEN 项可代入。
> 探针数据禁入评测（禁入 Eligible / 统计分母 / 指标），仅用于本基线冻结。

## §0 观测状态

- 探针：`research/source-probe/probe.ts`（REST 全扫 + WS 短窗口采样，详见同目录 README）。
- 观测窗（冻结依据）：2026-09-09T16:01:26Z → 2026-09-10T18:59:31Z，
  约 26.97h；cycles 1–1619 连续，**0 缺失 cycle**；
  REST 61,522 观测（38 targets/cycle），WS 54 会话
  （cycle 1 + 每 30 cycle 一次，OKX trades/mark + Binance trades+mark）。
- 常驻运行：`run-24h.sh`，60s 节拍；进程转正时刻仍存活（转正后是否继续由 Task Manager 定）。
- 全量汇总：`data/summary-24h-20260910T19Z.txt`（`summarize.ts` 输出，已落盘，git 隔离）。
- 24h 实测（本机站点）：
  - REST 成功率 99.636%（61,298/61,522），零限流（`rateLimited` 全 0，
    0×429/418 语义）；错误仅 `network/timeout` 两类；
    单 target 最低 OKX OI PEPE 97.9%（34 fail），Binance OI PEPE 98.4%（26 fail），
    其余 99.4%–99.9%。
  - latency：非 PEPE-OI target p50 约 116–167ms、p95 约 712–1388ms；
    PEPE OI p50 283–305ms、p95 2506–2749ms（显著高于其余通道）；
    全量 max 4926–7910ms（各 target max 均 < 8s）。
  - 连续失败最大 streak = 2（仅 2 起：Binance mark PEPE cycle 623–624；
    OKX OI PEPE cycle 1590–1591），从未达到 3；每次均下一 poll 自恢复。
  - OI/trades/mark/depth 源 ts 推进率 ~100%（事件 Δ 中位 ≈ 60s = 采集节拍；
    非 funding gap 仅 10 起，见 §4）。
  - funding 源 ts 按结算网格跳变（Binance = 上一结算时刻；OKX = 下一结算时刻，
    未来 dating，见 §3 limitation F-1）；窗口内跨过 ≥3 个结算边界（§6 条件 3 满足）。
  - OKX WS 存活：mark 54/54 会话 ok（~5 条/s，均间隔 ~200ms，全程稳定）；
    trades 53/54 ok（cycle 330 一次 transport 失败；消息数 2–1702/20s 窗，波动大）。
  - Binance WS：54/54 会话零业务推送（连接 + SUBSCRIBE ACK 正常，
    单流/组合流均复现；REST 正常）。本站点结论：备链路 WS 不可用，按 REST 执行。

## §1 collector_poll（FROZEN）

| 路径 | 冻结值 | 依据 |
|---|---|---|
| REST 全扫（38 targets 顺序执行，防自制造并发限流） | **FROZEN：60s** | cycle 起始间隔 p50 恰 60.0s；单 sweep 耗时 p50 5.6s（min 4.2s）≪ 60s；1619 cycles 0 缺失。超限：>90s 起始漂移 15 次（0.9%，max 157.3s，多为 WS 采样 cycle），>120s 3 次——节拍本身成立，偶发 overrun 计入容忍。 |
| WS 短窗口采样 | 观测手段（非冻结项）：首 cycle + 每 30 cycle 一次，窗口 20s | 54 会话如期执行。 |

## §2 exchange×field 基线表（六项）

> `stale_after / unavailable_after` 倍数关系沿 §6-0（stale = 2×基准、unavailable = 4×基准
> 或连续 heartbeat 超时）；绝对值 = 倍数 × 本表 `expected_source_update`。
> trades 行遵循 R2：transport 存活但无新成交仍 `HEALTHY`，`cadence_trade` 禁用于 stale 判定。
> depth 行：§6-0 集中表未收录 depth freshness 行，探针仅提供 cadence 观测，
> 映射口径待协议修订，本文件不自定（标 UNMAPPED，见 §7 limitation D-1）。

| exchange×field | expected_source_update（FROZEN，除注明外） | heartbeat（FROZEN，除注明外） | stale_after | unavailable_after | recovery |
|---|---|---|---|---|---|
| OKX × OI | **60s**（源 ts 逐 poll 推进；事件 Δ 中位 60.0s，推进率 100%；真节拍 ≤60s，上界冻结） | **REST 连续 2×cadence（120s）无响应**（窗口内 boundary 级触发 1 起：cycle 1590–1591 streak=2，下一 poll 自恢复） | **event age > 120s** | **event age > 240s 或连续 heartbeat 超时** | PROVISIONAL-UNVERIFIED（§7 R-1：窗口内无持续 outage，恢复路径未验证） |
| Binance × OI | **60s**（行为一致；事件 Δ 中位 60.3–60.6s，推进率 ~100%；PEPE OI latency 偏高 p50 283ms/p95 2506ms，但更新节拍不受影响） | **同上（120s）**（本通道无 streak=2 事件） | **event age > 120s** | **event age > 240s 或连续 heartbeat 超时** | PROVISIONAL-UNVERIFIED（§7 R-1） |
| OKX × trades | **连续事件流**（53/54 WS 会话存活；`cadence_trade` = 1m 仅上卷/回补对齐，**禁用于 stale 判定**，R2） | transport 心跳：WS 路径；`heartbeat_timeout_trade` 数值 **PROVISIONAL（未定，§7 T-1）**：20s 窗内未观测到服务端 ping，ttfm 实测 0.1–16s，无法钉住阈值 | **transport 断线/心跳超时即 stale**（Market Event Age 禁判，R2；窗口内实测 transport 失败 1 起 cycle 330） | **transport 断线 + 回补失败** | PROVISIONAL-UNVERIFIED（§7 R-1；WS 重连+缺口补齐未验证） |
| Binance × trades | **REST 源 ts 逐 poll 推进（上界 60s）**；**WS 在本站点零推送（54/54 会话零业务消息，ACK 正常），备链路按 rest-poll/rest-backfill 执行，禁依赖 WS**（生产地域 hnd1 需复验，§7 W-1） | **REST 连续 120s（2×poll）无响应**（WS 路径本站点不可用） | transport（= REST 连续可达性）断线即 stale | transport 断线 + 回补失败 | PROVISIONAL-UNVERIFIED（§7 R-1） |
| OKX × mark/index | **WS ~200ms 均间隔（~5 条/s），54 会话稳定（198–204ms）；REST 上界 60s** | **2×cadence_mark 无响应**（WS 主路径；本站点未观测到服务端 ping，按消息间隔计） | **event age > 400ms**（= 2×200ms；实测注意：单窗口消息间隔 p95 ≤ ~880ms 偶发，运营使用建议结合 REST 回退，见 §7 M-1） | **event age > 800ms 或连续 heartbeat 超时** | PROVISIONAL-UNVERIFIED（§7 R-1） |
| Binance × mark/index | **REST 上界 60s**（WS 同 trades 行本站点零推送，按 rest-poll 执行） | **REST 连续 120s 无响应** | **event age > 120s** | **event age > 240s 或连续 heartbeat 超时** | PROVISIONAL-UNVERIFIED（§7 R-1） |
| OKX × funding_current | **采集 cadence 60s**（= collector_poll）；结算网格 **DOGE/PEPE 8h、ETHFI 4h**（窗口内跳变：DOGE/PEPE 3 次边界、ETHFI 6 次）。**源 ts 为下一结算时刻（未来 dating），event-age 路径不适用，只走 heartbeat 路径（§7 F-1）** | **2×采集 cadence（120s）无响应** | **heartbeat 超时即 stale**（event age 恒为负，禁以 event age 判） | **heartbeat 连续超时或回补失败** | PROVISIONAL-UNVERIFIED（§7 R-1；`next_funding_time` 只表结算边界、禁作恢复依据） |
| Binance × funding_current | **采集 cadence 60s**；结算网格 **DOGE/PEPE 8h、ETHFI 4h**（源 ts = 上一结算时刻，8h/4h 网格一致） | **2×采集 cadence（120s）无响应** | **event age > 120s**（采集新鲜度口径，与 heartbeat 120s 无响应等价，禁按源 ts 字面年龄判；结算跳变本身非 stale） | **event age > 240s 或连续 heartbeat 超时** | PROVISIONAL-UNVERIFIED（§7 R-1） |
| OKX × funding_history | **结算周期：DOGE/PEPE 8h、ETHFI 4h**（由 current 行跳变次数直接观测：3/3/6 次边界） | **2×结算周期无响应**（DOGE/PEPE 16h；ETHFI 8h） | **超过 2 个 settlement 周期未更新** | **超过 4 个 settlement 周期或连续 heartbeat 超时** | PROVISIONAL-UNVERIFIED（§7 R-1；跨结算 outage 恢复未观测，需跨结算观测验证） |
| Binance × funding_history | **同上（DOGE/PEPE 8h、ETHFI 4h）** | **同上** | **同上** | **同上** | PROVISIONAL-UNVERIFIED（§7 R-1） |
| OKX × depth | UNMAPPED（观测：源 ts 逐 poll 推进，上界 60s；成功率 99.6%–99.9%） | UNMAPPED（§7 D-1） | UNMAPPED（禁自定） | UNMAPPED（禁自定） | PROVISIONAL-UNVERIFIED |
| Binance × depth | UNMAPPED（观测同上，成功率 99.6%–99.9%） | UNMAPPED（§7 D-1） | UNMAPPED（§7 D-1） | UNMAPPED（§7 D-1） | PROVISIONAL-UNVERIFIED |
| BTC × funding | N/A（产品语义：BTC 为环境参照，无资金费率基线；两所均不采集） | N/A | N/A | N/A | N/A |

## §3 timestamp 更新规律（冻结观测）

- OI / trades / mark / depth：双所四币源 ts 均逐 poll 前进（Δ 中位 ≈ 60s，
  源更新粒度 ≤ 60s；REST 口径上界即冻结值， §2）。
- funding_current：Binance 源 ts = 上一结算时刻（8h/4h 网格）；
  OKX 源 ts = 下一结算时刻（未来 dating，静态跨 poll、边界跳变 +8h/+4h）。
  两者结算网格一致（DOGE/PEPE 8h、ETHFI 4h），与 §6-0 双 funding 行一致。
- 双时间戳：每观测保留 `event_time_ms` + `receive_time_ms`，
  抓取时间未冒充市场时间。

## §4 REST latency / rate limit / gap（冻结值）

- latency（FROZEN 观测基线）：非 PEPE-OI 通道 p50 116–167ms、p95 712–1388ms；
  PEPE OI（双所）p50 283–305ms、p95 2506–2749ms；全量 max < 8s。
  详见 `data/summary-24h-20260910T19Z.txt` 分 target 行。
- rate limit（FROZEN）：**0 命中**（61,522 观测中 `rateLimited` 全 0；
  60s 顺序 sweep 下无 429/418 语义事件）。
- gap frequency（FROZEN）：推进类通道 10 起非 funding gap / 约 55k 推进观测
  （≈ 0.02%）：OKX trades ETHFI 7 起（Δ=0 六起：60s 窗内无新成交，属低流动正常态，
  R2 下禁判 stale；Δ=-5714ms 一起：源 ts 回退毫秒级）、OKX trades PEPE 1 起（Δ=0）、
  Binance OI BTC/ETHFI 各 1 起（Δ 为 -754ms/-420ms 负值：源 ts 毫秒级回退，
  非 transport 故障）。funding_current 跨 poll 静态属结算节拍，非 gap。
- 以上三项以 `summarize.ts` 全量输出（§0 落盘文件）为准转正。

## §5 WS heartbeat（冻结观测）

- OKX（`wss://ws.okx.com:8443/ws/v5/public`）：54 会话中
  trades 53 ok（ttfm 0.1–16s；20s 窗消息数 2–1702，随成交波动；cycle 330 一次 transport 失败）、
  mark 54 ok（ttfm ~0.1–1.5s；~99–101 条/20s，均间隔 198–204ms 全程稳定；
  cycle 870 一次量降 n=75）。
  20s 窗内未观测到服务端 `ping` 事件，心跳超时数值阈值未定（§7 T-1）。
- Binance（`wss://fstream.binance.com`）：54/54 会话连接 + SUBSCRIBE ACK 正常，
  但组合流与单流（`@aggTrade` / `@markPrice@1s`）零业务推送。
  结论（本站点，FROZEN）：备链路 WS 不可用，按 REST 执行；生产地域复验后再定（§7 W-1）。

## §6 转正条件核验（24h 后，本次执行）

1. 常驻 ≥ 24h 无中断——**满足**（26.97h，cycles 1–1619 连续，0 缺失；
   起始漂移 >90s 仅 15 次，属 overrun 容忍内）。
2. `summarize.ts` 全量——**已执行并落盘**（§0）。
3. ≥ 3 个 funding 结算边界——**满足**（DOGE/PEPE 各 3 次、ETHFI 6 次，双所一致；
   funding_history recovery 实证验证未发生 outage，从缺，recovery 行按预案保持 UNVERIFIED）。
4. Binance WS 生产地域（hnd1）复验——**未做，转 limitation**（§7 W-1）。
5. 本文件升版 v1.0-FROZEN——**本次执行**；未消号项（§7）不得代入判定。

## §7 未转正单项 limitation（冻结约束，禁编数、禁代入判定）

- **R-1（recovery 全行 UNVERIFIED）：** 窗口内无持续 outage（最大连续失败 streak=2，
  且均下一 poll 自恢复；无 stale→unavailable 完整episode），
  全部 12 行 recovery 保持 PROVISIONAL-UNVERIFIED。
  原因：无真实 outage 可验证恢复路径。后续如发生 outage，按 §6-8 独立建异常事件并回填验证。
- **T-1（OKX trades WS 心跳阈值未定）：** 20s 采样窗内无服务端 ping 可观测，
  ttfm 跨度 0.1–16s，无法以 24h 数据钉住 `heartbeat_timeout_trade` 数值。
  原因：观测手段（短窗口采样）不产生 ping 事件。需更长连续 WS 会话或显式 ping 观测后另行冻结。
- **W-1（Binance WS 本站点零推送）：** 54/54 会话 ACK 正常但零业务推送，
  备链路冻结口径为 rest-poll/rest-backfill。原因：本站点网络/地域因素未排除，
  生产地域（hnd1）复验前禁把"Binance WS 可用"代入任何判定。
- **D-1（depth freshness UNMAPPED）：** §6-0 集中表无 depth 行，
  本文件不自定 stale/unavailable 映射。原因：协议口径缺失，待协议修订；
  探针仅冻结 cadence 观测（上界 60s）。
- **F-1（OKX funding_current event-age 路径不适用）：** OKX 源 ts 为下一结算时刻
  （未来 dating），event age 恒为负，`event age > 2×cadence` 永不触发；
  该行 stale 只走 heartbeat（120s 无响应）路径。原因：交易所语义差异，
  属实测发现（非编数），判定侧必须按此执行，禁混用 Binance 口径。
- **M-1（OKX mark 400ms/800ms 为机械计算值）：** stale 400ms = 2×实测 200ms 节拍；
  实测单窗间隔 p95 偶发 ~880ms，运营侧建议结合 REST 回退综合判定，
  但倍数关系本身按 §6-0 冻结执行，本文件不另设宽松值（禁调参）。

## §8 forward evaluation 启动确认（只确认条件，不做评测）

- §6-P0.0 item 2 的冻结门：**已过**（本文件 v1.0-FROZEN 生效起）。
  正式 forward evaluation 可启动，但**仅 FROZEN 项可代入
  `stale_after / unavailable_after` 判定**；§7 六项 limitation 禁代入。
- probe 数据（`data/` 全部内容）继续禁入评测：禁计入 Eligible、
  禁入 §4.4/§5.2 统计（重申，不因转正改变）。
- 本节只确认门槛状态；评测设计与执行不在本任务内。

## §9 禁入评测重申

本文件与 `data/` 全部内容仅用于 cadence 基线冻结；禁计入 Eligible、禁入 §4.4/§5.2
统计、禁用于任何评分/权重/胜率口径。本探针与实时 Action 链双向零 import（见 README）。
