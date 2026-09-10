# SOURCE_CADENCE_BASELINE_V1（初版 v0.1-PROVISIONAL）

> 依据冻结协议 §6-P0.0：P0 建设第一步非评测 probe 的连续观测输出。
> 本文件冻结六项：`collector_poll` / `expected_source_update` / `heartbeat` /
> `stale_after` / `unavailable_after` / `recovery`（按 exchange×field 独立）。
> **状态：初版 PROVISIONAL**——观测窗不足（见 §0），绝对值未转正；
> 冻结前 §6-0 表中 `cadence_*` 绝对值一律视为未定，禁以猜测值代入
> `stale_after / unavailable_after` 判定，禁启动正式 forward evaluation。
> 探针数据禁入评测（禁入 Eligible / 统计分母 / 指标），仅用于本基线冻结。

## §0 观测状态

- 探针：`research/source-probe/probe.ts`（REST 全扫 + WS 短窗口采样，详见同目录 README）。
- 观测窗（初版）：2026-09-09 15:56–16:05 UTC，约 190 REST 观测 + 9 WS 观测
  （OKX 主 + Binance 备 × OI/trades/mark/funding_current/depth × PEPE/DOGE/ETHFI/BTC，
  funding 仅三交易标的，BTC funding 按产品语义记 N/A）。
- 常驻运行：目标 ≥ 24h（`run-24h.sh` 已启动，60s 节拍，WS 每 30 cycle 采样一次）；
  满 24h（≈ 2026-09-10 16:00 UTC）后复核本文件并转正（PROVISIONAL → FROZEN）。
- 初版结论（本机站点）：REST 190/190 成功、零限流（0×429/418）、latency p50 约 100–200ms
  （最大 1037ms，Binance PEPE OI）；OI/trades/mark/depth 源 ts 逐 poll 推进；
  funding 源 ts 跨 poll 静态（结算节拍）；OKX WS 存活（trades ~8–10 条/20s，
  mark-price ~5 条/s）；Binance WS 连接成功但零业务推送（REST 正常）。
  全部为小样本初值，见下表 PROVISIONAL 标记。

## §1 collector_poll（探针采集节拍，候选冻结值）

| 路径 | 候选值 | 状态 |
|---|---|---|
| REST 全扫（38 targets 顺序执行，防自制造并发限流） | 60s（单 sweep 实测 5–10s） | PROVISIONAL（待 24h：限流/耗时分布转正） |
| WS 短窗口采样 | 首 cycle + 每 30 cycle 一次，窗口 20s | PROVISIONAL（采样策略本身非冻结项，仅观测手段） |

## §2 exchange×field 基线表（六项）

> `stale_after / unavailable_after` 倍数关系沿 §6-0（stale = 2×基准、unavailable = 4×基准
> 或连续 heartbeat 超时）；绝对值 = 倍数 × 本表 `expected_source_update`，在转正前一律 PROVISIONAL。
> trades 行遵循 R2：transport 存活但无新成交仍 `HEALTHY`，`cadence_trade` 禁用于 stale 判定。
> depth 行：§6-0 集中表未收录 depth freshness 行，探针仅提供 cadence 观测，
> 映射口径待协议修订，本文件不自定（标 PROVISIONAL-UNMAPPED）。

| exchange×field | expected_source_update（源更新节拍） | heartbeat | stale_after | unavailable_after | recovery |
|---|---|---|---|---|---|
| OKX × OI | PROVISIONAL：≤ 60s 上界（源 ts 逐 60s poll 推进；真节拍需高频采样钉住） | PROVISIONAL：REST 连续 2×cadence 无响应 | PROVISIONAL：event age > 2×cadence_oi | PROVISIONAL：event age > 4×cadence_oi 或连续 heartbeat 超时 | PROVISIONAL：新 OI 事件到达且 event_time 前进（24h 内尚无真实 outage，恢复路径未验证） |
| Binance × OI | 同上（行为一致，latency 略高，PEPE OI 曾 1037ms） | 同上 | 同上 | 同上 | 同上 |
| OKX × trades | PROVISIONAL：连续事件流（WS 实测 PEPE ~2.7s 均间隔；`cadence_trade` = 1m 仅上卷/回补对齐，禁用于 stale 判定） | PROVISIONAL：WS 无消息超 heartbeat_timeout_trade（OKX 20s 窗内未观测到服务端 ping 事件，超时阈值未定） | transport 断线/心跳超时即 stale（Market Event Age 禁判，R2） | transport 断线 + 回补失败 | PROVISIONAL：WS 重连 + 序列缺口补齐（未验证） |
| Binance × trades | PROVISIONAL：REST 源 ts 逐 poll 推进；**WS 在本站点零推送（连接+SUBSCRIBE ACK 正常，单流/组合流/BTC 均复现），备链路按 rest-poll/rest-backfill 执行，禁依赖 WS**（生产地域 hnd1 需复验） | PROVISIONAL：REST 连续 2×poll 无响应（WS 路径本站点不可用） | 同 OKX 行 transport 语义，transport = REST 连续可达性 | transport 断线 + 回补失败 | PROVISIONAL（未验证） |
| OKX × mark/index | PROVISIONAL：WS 实测 PEPE mark-price ~200ms 均间隔（~5 条/s）；REST 上界 60s | PROVISIONAL：2×cadence_mark 无响应（WS ping 机制本站点未观测到） | PROVISIONAL：event age > 2×cadence_mark | PROVISIONAL：event age > 4×cadence_mark 或连续 heartbeat 超时 | PROVISIONAL：新 mark/index 事件到达且 event_time 前进（未验证） |
| Binance × mark/index | PROVISIONAL：REST 源 ts 逐 poll 推进；WS 同 trades 行本站点零推送，按 rest-poll 执行 | 同上（REST 口径） | 同上 | 同上 | PROVISIONAL（未验证） |
| OKX × funding_current | PROVISIONAL：源 ts 跨 poll 静态（实测恒为 16:00 UTC 记录）；实际采集 cadence = collector_poll 60s | PROVISIONAL：2×cadence_funding_current 无响应 | PROVISIONAL：event age > 2×cadence_funding_current | PROVISIONAL：event age > 4×cadence_funding_current 或连续 heartbeat 超时 | PROVISIONAL：新 funding_current 到达且事件时间前进；`next_funding_time` 只表结算边界、禁作恢复依据（未验证） |
| Binance × funding_current | PROVISIONAL：源 ts 为结算时刻（实测 08:00/12:00 UTC），8h 结算节拍一致；采集 cadence = 60s | 同上 | 同上 | 同上 | 同上 |
| OKX × funding_history | PROVISIONAL：cadence_funding_history = funding 结算周期 8h（由 current 行静态 ts + 结算时刻推断，未完整观测 ≥2 个结算周期） | PROVISIONAL：2×结算周期无响应 | PROVISIONAL：event age 超过 2 个 settlement 周期未更新 | PROVISIONAL：超过 4 个 settlement 周期或连续 heartbeat 超时 | PROVISIONAL：新 funding 历史记录到达且 fundingTime 前进（未验证，需跨结算观测） |
| Binance × funding_history | 同上 | 同上 | 同上 | 同上 | 同上 |
| OKX × depth | PROVISIONAL-UNMAPPED：源 ts 逐 poll 推进（上界 60s）；freshness 映射待协议修订 | PROVISIONAL：REST 连续无响应（阈值未定） | UNMAPPED（禁自定） | UNMAPPED（禁自定） | PROVISIONAL（未验证） |
| Binance × depth | 同上 | 同上 | UNMAPPED（禁自定） | UNMAPPED（禁自定） | PROVISIONAL（未验证） |
| BTC × funding | N/A（产品语义：BTC 为环境参照，无资金费率基线；两所均不采集） | N/A | N/A | N/A | N/A |

## §3 timestamp 更新规律（初版观测）

- OI / trades / mark / depth：双所四币源 ts 均逐 poll 前进（delta ≈ 采集间隔，
  说明源更新粒度 ≤ 60s，真值待高频采样）。
- funding_current：Binance 源 ts = 结算时刻（8h 网格）；OKX 源 ts 跨 poll 静态。
  两者均符合“history 按 settlement 对齐”预期，与 §6-0 双 funding 行一致。
- 双时间戳：探针每观测保留 `event_time_ms` + `receive_time_ms`（见 JSONL schema），
  抓取时间未冒充市场时间。

## §4 REST latency / rate limit / gap（初版观测）

- latency：p50 约 100–200ms；p95 待 24h 样本；实测最大 1037ms（Binance PEPE OI）。
- rate limit：0 命中（60s 顺序 sweep，无 429/418；响应头限流字段待补记——PROVISIONAL）。
- gap frequency：0（推进类通道逐 poll 推进；funding 静态属结算节拍，非 gap）。
  以上三项 24h 后以 `summarize.ts` 全量输出转正。

## §5 WS heartbeat（初版观测）

- OKX（`wss://ws.okx.com:8443/ws/v5/public`）：trades 首消息 0.1–4s、约 8–10 条/20s；
  mark-price 首消息 ~0.1s、约 99–100 条/20s。20s 窗内未观测到服务端 `ping` 事件，
  心跳超时阈值未定（PROVISIONAL，需更长窗口/显式 ping 观测）。
- Binance（`wss://fstream.binance.com`）：连接 + SUBSCRIBE ACK 正常，
  但组合流与单流（`@aggTrade` / `@markPrice@1s`，含 BTC）12s/9s 窗内零业务推送。
  结论（本站点，PROVISIONAL）：备链路 WS 不可用，按 REST 执行；生产地域复验后再定。

## §6 转正条件（24h 后）

1. 常驻 ≥ 24h 无中断（中断需注明缺口，缺口段禁外推）。
2. `summarize.ts` 全量：分 target ok 率 / latency p50/p95/max / 事件推进率 / gap 计数 /
   限流计数 / errorKind 直方图；WS 会话成功率与消息间隔分布。
3. 至少观测到 3 个 funding 结算边界（含 funding_history recovery 一次验证更佳；
   若无 outage，recovery 行保持 PROVISIONAL-UNVERIFIED 并注明）。
4. Binance WS 在生产地域（hnd1）复验结论回填。
5. 转正时本文件升版（v1.0-FROZEN），PROVISIONAL 逐项消号；未消号项不得代入判定。

## §7 禁入评测重申

本文件与 `data/` 全部内容仅用于 cadence 基线冻结；禁计入 Eligible、禁入 §4.4/§5.2
统计、禁用于任何评分/权重/胜率口径。本探针与实时 Action 链双向零 import（见 README）。
