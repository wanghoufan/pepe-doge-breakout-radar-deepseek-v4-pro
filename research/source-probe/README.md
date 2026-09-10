# P0.0 Source Characterization 探针（非评测）

> **隔离与禁入评测声明（冻结口径，§6-P0.0）：**
> - 本目录为**非评测探针**，独立于 `src/` 实时 Action 链：双向零 import（实时链路禁消费本目录任何文件，本探针不 import `src/` 任何业务模块）。
> - `data/` 下全部探针观测数据**默认禁入评测**：禁计入 Eligible 数据集、禁入 §4.4 / §5.2 任何统计分母与指标，仅用于冻结 `SOURCE_CADENCE_BASELINE_V1.md` 的 cadence 基线。
> - 范围冻结：标的仅 PEPE / DOGE / ETHFI + BTC（环境参照）；交易所仅 OKX（主）+ Binance（备）。禁新增币种数据源，禁 Bybit / CoinGlass（含常量）。
> - 本探针无权重 / 评分 / 胜率 / 收益类输出（Quant NONE）。
> - `SOURCE_CADENCE_BASELINE_V1.md` 冻结前，禁启动正式 forward evaluation（被禁的是评测，不是本探针）。

## 文件

| 文件 | 说明 |
|---|---|
| `probe.ts` | 探针主程序：REST 全扫（OKX 主 + Binance 备 × OI/trades/mark/funding_current/depth）+ WS 短窗口存活采样 |
| `summarize.ts` | 统计脚本：按 exchange×channel×coin 输出 ok 率 / latency / 事件推进率 / gap / 限流统计 |
| `run-24h.sh` | 后台常驻包装（目标 ≥ 24h，nohup + 日志轮转说明） |
| `SOURCE_CADENCE_BASELINE_V1.md` | 基线文件初版（含 PROVISIONAL 项，满 24h 后转正） |
| `data/` | 观测数据（JSONL + summary，git 隔离，禁入评测） |

## 运行

```bash
# 单次全扫（连通验证，约 1～3 分钟，含一次 WS 采样）
npx tsx research/source-probe/probe.ts --once

# 短跑验证（N 个采集周期）
npx tsx research/source-probe/probe.ts --cycles 20 --interval-ms 60000

# 常驻（目标 ≥ 24h）
bash research/source-probe/run-24h.sh

# 统计
npx tsx research/source-probe/summarize.ts
npx tsx research/source-probe/summarize.ts research/source-probe/data/probe-xxx.jsonl
```

## 参数

| 参数 | 缺省 | 说明 |
|---|---|---|
| `--once` | — | 单次全扫后退出（含一次 WS 会话） |
| `--cycles N` | 0（无限） | 采集周期数 |
| `--interval-ms` | 60000 | REST 全扫节拍（`collector_poll` 候选值，基线冻结前为 PROVISIONAL） |
| `--ws-seconds` | 20 | 每次 WS 采样窗口秒数 |
| `--ws-every` | 30 | 每 N 个 cycle 做一次 WS 采样（首 cycle 必做） |

## 数据格式（JSONL，一行一观测）

- REST：`{kind:'rest', probe_cycle, exchange, channel, coin, url, ok, httpStatus,
  vendorCode, errorKind, errorDetail, latencyMs, rateLimited, event_time_ms,
  receive_time_ms, event_advanced, event_delta_ms}`
  - `event_time_ms` = 源事件时间（OKX: oi.ts / trades 首条 ts / mark.ts /
    funding.fundingTime / books.ts；Binance: openInterest.time / aggTrades.T /
    premiumIndex.time / fundingRate.fundingTime / depth.T），null = 响应无可用源 ts。
  - `event_advanced/event_delta_ms` = 相对上次同 target 成功观测的源 ts 推进情况，
    用于观测 timestamp 更新规律与 gap frequency。
- WS：`{kind:'ws', probe_cycle, exchange, channel, coin, url, ok, timeToFirstMsgMs,
  msgCount, intervalMeanMs, intervalP95Ms, heartbeatOk, windowMs}`
