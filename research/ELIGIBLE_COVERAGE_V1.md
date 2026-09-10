# Eligible Dataset 初版覆盖报告（V1，coverage v0-empty）

> 口径依据：`PRE_ALERT_DATA_PROTOCOL_V1.md` §4.4（HIGH-2 Eligible Dataset）。
> 本报告为初版：只建立 universe 声明与空覆盖基线，不报任何指标。
> 禁权重/评分/调参/胜率模型化（本任务禁令）。

## §1 强制报告项（§4.4 item 2）

| 项 | 值 |
|---|---|
| `historical_universe_episode_n` | **116**（Independent Episodes；成功 41 / 失败 75，冻结标签 72H MFE ≥ 10% AND MAE ≥ −8%） |
| `historical_universe_normal_n` | **760**（可评 normal 窗口；总数 768，48H 固定/stride 48H/无重叠） |
| `eligible_episode_n`（新字段实验） | **0**（forward 采集 store 尚未建立，无 coverage 窗口） |
| `eligible_normal_n`（新字段实验） | **0**（同上） |
| coverage 起止（UTC ms） | **无（尚未开始 forward 采集）** |
| `coverage_pct` | **0%**（0/116 episodes，0/760 normal） |

## §2 missing_by_field（相对 universe 全集）

| 字段 | 缺失规模 | 说明 |
|---|---|---|
| OI（venue-aware `oi_notional_usd`） | 116/116 + 760/760 全缺 | 无历史 store；仅 cadence 基线已冻结（`SOURCE_CADENCE_BASELINE_V1.md` v1.0-FROZEN） |
| trades / taker-CVD | 全缺 | 同上 |
| mark / index / funding-basis | 全缺 | 同上 |
| depth | 全缺 | 同上（且 freshness 映射待协议修订，基线 D-1） |
| 跨所一致性（cross-market） | 全缺 | 同上 |
| funding（现货 snapshot 口径） | 部分存在 | `src/data/funding/` 仅 PEPE/DOGE（21 事件子集口径）；ETHFI 零基线样本（21 事件：PEPE 11 + DOGE 10，ETHFI 0），沿冻结约束一律标"未知/缺失"，禁编造 |

## §3 missing_by_source

| 源 | 缺失规模 | 说明 |
|---|---|---|
| OKX（主） | forward store 100% 缺失 | probe 观测（27h，REST 99.636% ok）仅为 cadence 基线证据，**禁计入 Eligible**（§6-P0.0 item 3） |
| Binance（备） | forward store 100% 缺失 | 同上；且本站点 WS 零推送，按 REST 口径（基线 W-1） |

## §4 三禁自检（§4.4 item 4）

- 未来补历史：无（无回填动作）。
- missing 当 0：无（缺失如实记 missing，未做任何填补）。
- 无字段 Episode 进分母：无（eligible_n = 0，分母为空，禁报指标）。

## §5 forward 评测可启动确认（只确认条件，不做评测本身）

- 基线门（§6-P0.0 item 2）：**已过**——`SOURCE_CADENCE_BASELINE_V1.md` v1.0-FROZEN
  生效（§8）；FROZEN 项可代入 `stale_after / unavailable_after` 判定，
  六项 limitation（R-1/T-1/W-1/D-1/F-1/M-1）禁代入。
- 数据门（本报告）：**未过**——forward 采集尚未启动，eligible 为空；
  评测可启动的是"基线条件"，实评需等 forward store 产生 coverage 后
  按 §4.4（全集口径声明 + eligible 子集实评并列）执行。
- 结论：**可进入评测准备/采集建设阶段**；正式 forward evaluation 的分母
  与指标动作不在本任务内，本报告不预设。
