# PRODUCT_FUNCTION_REVIEW｜PEPE / DOGE Breakout Radar 产品与预警能力审查

> 修订日期：2026-09-08（UTC+8）  
> 审查角色：Product / Function Reviewer（非开发者）  
> 修订原因：按用户纠正，本报告以“能否提前、可靠地发出有价值的预警”为最高产品目标；界面、声音和设置仅作为预警链路的配套能力，不再作为审查主线。  
> 本轮不修改业务代码，不改变 Rolling 42、4H confirmed、Episode、Setup、Trigger、Follow-through、Hard Veto、M5 或回测阈值。  
> 主证据：`ALERT_CENTER_PRODUCTION_CLOSEOUT.md`；配套复核 Phase A / B、Action Card、Freshness、Backtest、Incremental Model、Walk-forward、QA 台账和当前生产页面。外部数据可获得性以 2026-09-08 官方 API 文档为准。

## 1. 核心结论：当前是“状态提醒器”，还不是可靠的“提前预警雷达”

当前产品已经能做到：

- 每 60 秒读取一次当前 Action；
- 当 WATCH、BREAKOUT_TRACK、RETEST_WATCH、REJECT、DATA_BLOCKED 等状态变化时提醒；
- 只有已收盘 4H K 线确认突破；
- 数据过期时停止判断；
- 页面打开期间通过声音、弹窗、横幅、标签闪烁提示用户。

这能提醒用户“状态已经发生变化”，但对“突破发生前的提前预警”仍明显不足。当前实时数据核心仍是：OKX 价格与 K 线、K 线成交量、BTC 环境、Binance/OKX 资金费率。它缺少能描述临界阶段资金参与、杠杆变化、主动买卖和市场深度的数据。

更重要的是，现有研究已经明确：M1–M4 在 walk-forward 中没有证明优于裸突破；M5 只有候选价值。因此，不能把当前 Setup 高分、靠近压力位或成交量放大直接称为“可靠预警”。

**本项目下一阶段最重要的工作不是继续丰富提醒样式，而是建立一套可验证的提前预警数据层与研究闭环。**

最终结论：`NEED_ADJUSTMENT`。

## 2. 预警产品真正要回答的 4 个问题

用户需要的不是更多指标，而是四个连续答案：

1. **有没有开始接近机会？** 距离本轮关键位还有多远，接近速度是否加快。
2. **这次接近有没有真实参与？** 成交量、主动买盘、持仓量是否同步，而不是只有价格瞬时拉升。
3. **是否已经确认？** 4H 收盘是否站上突破位；未收盘只能叫试探，不能叫确认。
4. **确认后是否继续有效？** 是否站稳、回踩是否守住、是否过热、是否被 BTC 环境或数据异常否决。

当前产品对第 3、4 问相对成熟；对第 1 问只有 Setup/距离；对第 2 问证据明显不足。这就是预警能力的核心缺口。

## 3. 当前最有价值的 3 个功能

1. **4H 已收盘确认 + 独立 Episode**：避免把未收盘冲高当成正式突破，也避免连续创新高被重复切碎。
2. **Freshness + DATA_BLOCKED**：数据不可靠时停止输出，是任何预警系统的可信底座。
3. **状态变化 Alert + ACK/去重**：已经具备把研究状态送达用户的基础，但监测端和数据端仍需升级。

Action Card 是重要解释层，但它本身不会提高预警准确性；声音、Pattern、Modal 也不会提高预警质量。

## 4. 当前预警能力评估

| 能力 | 当前情况 | 产品判断 |
|---|---|---|
| 突破前蓄势提醒 | 有 WATCH/Setup，但 M1–M4 未证明样本外增量 | 只能作为实验观察，不能称可靠预警 |
| 临界接近提醒 | 有当前价格与突破位距离，但没有专门的“临界接近”事件研究 | 能做基础提醒，容易被普通波动触发 |
| 突破试探提醒 | 当前形成中 4H K 线不确认，逻辑诚实 | 缺少“试探但未确认”的独立低等级预警 |
| 4H 突破确认 | 已实现 BREAKOUT_TRACK | 当前最可靠的机会提醒 |
| 回踩/失效提醒 | 已实现 RETEST_WATCH / REJECT | 有用，但原因需要更具体 |
| 数据异常提醒 | DATA_BLOCKED 已实现 | 方向正确，但彻底请求失败可能静默，重入去重也可能漏报 |
| 关页持续监控 | 未实现 | 无法真正替代盯盘 |
| 多数据源交叉确认 | 价格/K线主要依赖 OKX；funding 有 Binance/OKX 回退 | 不足以抵抗单一交易所异常或局部假动作 |
| 预警效果验证 | 有突破研究与 walk-forward | 缺少专门以“提前多久、一天误报几次、最终转确认多少”为目标的预警评估 |

## 5. 最核心的数据缺口：应该补什么

以下优先级不是“哪个指标听起来高级”，而是“哪个数据最可能帮助区分真实参与和价格噪声”。所有新数据都必须先进入研究层验证，验证通过后才能进入实时预警。

### P0-A｜未平仓量 Open Interest 及其变化

需要记录：当前 OI、15m/1h/4h OI 变化率、OI 的 USDT 名义价值、价格与 OI 的组合、OKX/Binance/Bybit 各交易所及聚合 OI。

为什么重要：它能告诉我们价格变化是否伴随新的杠杆仓位进入。但必须避免错误解释：

- 价格上涨 + OI 上升，只表示新增仓位参与，不能直接证明多头正确；
- 价格上涨 + OI 下降，可能是空头回补；
- OI 暴增也可能意味着拥挤和更高回撤风险。

所以 OI 应先作为“参与度/拥挤度证据”，不能直接做看涨分。

### P0-B｜主动买卖成交量与 CVD 代理

需要记录每笔成交的 taker side、5m/15m/1h 主动买入量与主动卖出量、taker buy/sell ratio、累积成交量差（CVD proxy），并把现货与永续分开计算。

为什么重要：普通 K 线成交量只能告诉我们“成交多了”，不能告诉我们成交由主动买入还是主动卖出推动。突破前价格接近压力位时，主动买盘是否持续，比单一 volumeRatio 更接近预警需求。

边界：交易所成交方向只是撮合层代理，不等于“真实资金净流入”，更不等于未来上涨概率。

### P0-C｜现货与永续的参与是否一致

需要记录 PEPE/DOGE 现货成交量、对应永续成交量、现货价与永续 mark/index price、premium/basis，以及现货主动买入与永续主动买入是否同步。

为什么重要：如果只有永续快速拉升、OI 和 funding 同时拥挤，而现货参与弱，预警应更谨慎；如果现货与永续共同放量，至少说明参与更广。这个逻辑仍需在项目历史样本中验证，不能先验宣称有效。

### P0-D｜盘口流动性与突破位附近深度

需要记录 best bid/ask 与 spread、距现价 ±0.5%/±1% 的买卖盘深度、突破位上方卖盘厚度、结构失效位下方买盘厚度、深度是否持续，以及假设下单金额下的估算滑点。

为什么重要：突破位前是否存在明显卖墙、卖墙是否被持续消耗，会影响“接近关键位”的实用性。

边界：订单簿可撤单、可伪装，不能把单次大单当作可靠信号。应使用持续时间、成交验证和多交易所一致性降低 spoofing 影响。

### P0-E｜资金费率、Mark/Index 与 Premium 的完整组合

当前已有 funding，但应补当前与历史 funding、下一次 funding 时间、mark price、index price、premium/basis、多交易所 funding 分歧，以及条件允许时的 OI 加权 funding。

资金费率单独使用信息有限；与 OI、premium、价格速度组合后，才能更好地区分正常参与与杠杆拥挤。

### P1-A｜强平数据

需要记录多空强平金额、方向、时间和交易所。它更适合解释突破/急跌是否伴随 forced flow，以及判断风险阶段；通常属于同步或滞后证据，不应被当作最早的预警触发器。

### P1-B｜跨交易所价格与成交一致性

同一时刻比较 OKX、Binance、Bybit 的价格偏差、成交量变化、OI 变化、funding/premium、数据更新时间与异常状态。只有一个交易所出现突破时，应降低预警可信等级或标记“单源异动”，而不是直接按全市场突破处理。

### P2｜链上、社交和新闻数据

链上大额转账、交易所流入流出、社交热度和新闻可以作为解释材料，但本阶段不应优先：地址标签可能不完整，PEPE/DOGE 的短周期永续波动与链上事件不一定时点对应，社交数据噪声和操纵风险也高。先把交易所微观结构数据做好。

### 最小可行数据包：先补 5 项，不要一次铺开所有数据

第一轮只收集与“提前发现突破准备”最直接的五类字段：

1. 现价距离突破位的百分比、接近速度与停留时间；
2. 15m / 1h OI 变化率和 USDT notional 变化；
3. 5m / 15m taker buy/sell 和 CVD proxy；
4. 现货与永续的同步成交量、价差与方向一致性；
5. 每个数据源的 event time、receive time、延迟、断流与恢复状态。

这个最小包先回答“有没有更早、是否减少假突破、数据是否可信”。盘口深度、强平和付费聚合数据可在第一轮证明有基础增益后再加，避免数据堆砌。

## 6. 从哪里获得这些数据

| 要补的数据 | 主数据源 | 交叉数据源 | 接入建议 |
|---|---|---|---|
| 价格、K 线、逐笔成交 | OKX Market REST / Public WebSocket | Binance USDⓈ-M、Bybit V5 | OKX 作主源，另一所做时间戳和价格偏差校验 |
| OI 及变化 | OKX Open Interest REST / WebSocket | Bybit Open Interest、Binance Futures Market Data | 统一换算为 USDT notional，保留原始合约单位 |
| Funding、Mark、Index、Premium | OKX Public Data | Binance、Bybit | 同时保留当前值、历史值和下次资金费时间 |
| Taker buy/sell、CVD proxy | OKX Trades 自行聚合 | Binance aggTrade / taker 统计、Bybit Recent Trades | 先按 1m 落库，再聚合到 5m / 15m；不只保留最终指标 |
| 现货/永续参与一致性 | OKX Spot + Swap | Binance Spot + USDⓈ-M、Bybit Spot + Linear | 分开保存后再生成一致性特征 |
| 订单簿与滑点 | OKX Books WebSocket | Binance Depth、Bybit Orderbook | 保存周期性快照和聚合深度，不把单次大挂单当事实 |
| 强平 | OKX Liquidation Orders WebSocket | Bybit All Liquidation；CoinGlass 聚合 | 定位为同步/滞后风险证据，不定位为最早触发器 |
| 跨所聚合历史 | 自建持续采集 | CoinGlass API V4 | 先评估自建成本与历史深度，付费后仍不作唯一生产源 |

正式开发前，必须对每个目标 symbol 做一次数据可用性预检：是否上市、合约乘数、时区、单位、更新频率、历史深度、rate limit 和用户所在地区可用性。表中是产品级数据路线，不是允许开发时盲写接口常量。

### 6.1 首选主源：OKX 公共 REST + WebSocket

当前项目已使用 OKX 价格和 K 线，可以继续从同一官方公共数据体系补充 Ticker、Candles、Trades、Order Book、Open Interest、Funding History、Mark/Index Price、Premium，以及 WebSocket 的 tickers、trades、books、open-interest、funding-rate、liquidation orders。

OKX 官方说明其公共市场数据包括 ticker、order book、trades、K 线、funding、mark/index price 和 OI，公共市场数据无需 API Key，但受 IP rate limit 与地区可用性约束：  
[OKX API 官方文档](https://www.okx.com/docs-v5/en/) · [OKX 公共数据范围与无 Key 说明](https://www.okx.com/en-us/help/okx-api-agreement)

产品建议：OKX 继续作为主行情源，但不能继续作为价格/K线/OI/成交方向的唯一事实源。

### 6.2 免费交叉源：Binance USDⓈ-M Futures

适合补充 `1000PEPEUSDT`、`DOGEUSDT` 的 OI 与 OI 历史、funding、mark/index/premium、taker buy/sell volume、aggTrade、depth，以及现货/永续对照。

Binance 官方文档提供 REST 与 WebSocket 市场数据，并明确公开流可订阅 aggregate trades 与 depth：  
[Binance USDⓈ-M WebSocket 官方文档](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Live-Subscribing-Unsubscribing-to-streams) · [Binance Futures 官方介绍](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/Introduction)

注意 `1000PEPEUSDT` 与 OKX `PEPE-USDT-SWAP` 的合约单位不同。必须统一成 USDT notional 或标准化基准，不能直接比较原始合约数量。

### 6.3 第二免费交叉源：Bybit V5

Bybit 官方 V5 市场接口提供 Kline、Orderbook、Ticker、Funding History、Recent Trades、Open Interest、Long/Short Ratio；公共 WebSocket 还提供线性合约流与全量强平流：  
[Bybit V5 Market 官方目录](https://bybit-exchange.github.io/docs/api-explorer/v5/market/market) · [Bybit Open Interest](https://bybit-exchange.github.io/docs/v5/market/open-interest) · [Bybit Funding History](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate) · [Bybit All Liquidation](https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation)

接入前应先用 instruments-info 验证 PEPEUSDT、DOGEUSDT 当前是否在目标地区与产品类型可用，不要写死假设。

### 6.4 付费聚合备选：CoinGlass API V4

CoinGlass 可一次提供跨交易所聚合的 OI、OI 加权 funding、taker buy/sell、强平、订单簿与部分链上数据，适合快速建立历史研究数据集、作为多交易所聚合基准，并减少自行维护多个历史接口的成本。

[CoinGlass V4 Endpoint Overview](https://docs.coinglass.com/reference/endpoint-overview) 列出了 aggregated OI、funding、taker buy/sell、liquidation 和 orderbook 接口；[官方价格页](https://www.coinglass.com/pricing) 显示不同套餐的频率、历史范围和商业使用权限。

建议先用交易所公共数据完成 P0 原型和小规模历史收集；如果历史深度、跨所标准化或强平聚合成本过高，再由用户决定是否购买 CoinGlass。不要把付费聚合商作为唯一生产源。

## 7. 数据接入的正确顺序

### 第一步：先采集，不改实时决策

新增数据先只进入 server-side research store，保留原始值、交易所、symbol、contract unit、event time、receive time、freshness、错误码和是否补录。实时 Action 不消费这些字段。

### 第二步：建立统一时点数据集

至少对 PEPE、DOGE、BTC 保存：1m/5m/15m/1h/4h K 线、trades/aggTrades 聚合、OI、funding、mark/index/premium、orderbook 深度摘要、liquidations 和数据源健康状态。

历史样本必须包含成功突破、失败突破、普通行情窗口和数据异常窗口。只补成功案例会再次制造幸存者偏差。

### 第三步：逐项做增量研究

对每个候选数据独立回答：

- 加 OI 后，比“仅价格距离 + 量比”少了多少误报？
- 加主动买卖量后，是否提高了突破前的提前量或确认转化？
- 加现货/永续一致性后，是否能识别单纯合约拉升？
- 加盘口深度后，效果是否稳定，还是只在少数事件有效？
- 加跨交易所一致性后，是否减少单源异常？

必须继续使用 point-in-time、campaign-level walk-forward 和未来独立 holdout。只有有样本外增量的数据才进入实时预警。

### 第四步：最后才调整状态与提醒

验证通过后，才决定是否把新证据加入 Action、Hard Veto 或提醒等级。不要因为 API 能取到数据就把它放进产品。

## 8. 建议的预警分层

这不是直接改算法，而是下一轮研究与产品设计目标。

- **L0 无预警**：距离关键位较远，或数据不足。只显示当前状态，不打扰用户。
- **L1 准备中**：结构开始形成，但尚未接近突破位。默认不发声音，只进入观察列表。
- **L2 临界接近**：价格已接近本轮突破位，同时至少有部分参与度证据。它是用户真正需要的提前预警，但必须标注“未突破、未确认”。
- **L3 突破试探**：形成中 K 线一度越过突破位，并出现成交/OI/主动买盘变化。只做低等级即时提醒；明确“4H 尚未收盘，可能回落”。
- **L4 4H 收盘确认**：对应当前 BREAKOUT_TRACK，是强提醒。确认后再观察站稳和回踩。
- **L5 回踩/失效/数据异常**：分别使用机会、风险、系统异常三类提醒，不能共用一种声音和严重级别。

## 9. 怎样衡量“预警更可靠”

不能只看上涨结果，也不能只看 Precision。预警研究至少要报告：

- 提前量：首次预警距 4H 突破确认多久；
- 捕获率：最终确认的突破中，有多少提前出现过 L2/L3；
- 预警转确认率：发出的 L2/L3 中，有多少最终 4H 确认；
- 假警报负担：每币每天/每周多少条未确认预警；
- 重复提醒数：同一 Episode 平均提醒次数；
- 撤销速度：预警失效后多久通知用户；
- 弱市表现：不同 campaign、不同市场环境下是否仍稳定；
- 数据可用率：每个源的 uptime、延迟、缺口和交叉不一致率；
- 送达可靠性：服务端检测延迟、推送成功率、重复率与漏发率。

建议由用户确认产品门槛，例如“提前量至少达到多少、每天最多接受几次误报、关键提醒最多允许延迟多久”。这些是产品 SLO，不是交易收益承诺。

## 10. 数据可靠性设计

1. 每个数据字段都保留 event time 与 receive time，禁止把抓取时间冒充市场时间。
2. 每个源单独 freshness；不能因为 OKX 价格正常就把 Binance OI 也视为正常。
3. 主源 + 至少一个交叉源；价格偏差或时间戳异常时降级为“单源数据”。
4. 原始数据与派生指标分开存储，能够重新计算。
5. WebSocket 断线要有重连、序列缺口检测和 REST 回补。
6. 不同交易所的合约单位、1000PEPE 与 PEPE 标识统一标准化。
7. 服务端记录去重键、状态版本和推送结果，支持幂等重试。
8. 数据完全失败本身必须触发系统异常事件，不能因为 fetch 抛错而静默。

## 11. Alert Center 能否真正承担预警

当前 Alert Center 的表现层已经够多，短板不是声音不够，而是监测方式：只在页面打开时轮询、间隔 60 秒、后台标签可能被节流、关页后停检、新用户声音未解锁、系统通知默认关闭、完全请求失败可能不生成 DATA_BLOCKED、双币报警可能声音叠加。

要承担可靠预警，下一阶段应优先建设：

`交易所 WebSocket/REST → 服务端持续采集 → 状态机 → 幂等事件存储 → 推送队列 → Web Push → 用户 ACK`

Web Push 可以在网页不处于前台、甚至当前未加载时由 service worker 接收服务器消息，但仍需要用户授权、有效订阅和浏览器/系统支持：[MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)。桌面浏览器彻底退出时的行为存在平台差异，不能承诺所有环境必达。

当前项目部署在 Vercel。Vercel Cron 的 Pro 最小间隔是 1 分钟且不保证精确触发，Hobby 只能每天一次；官方还说明 Cron 失败不会自动重试。因此它可以做分钟级兜底，不适合单独承担连续 WebSocket 和高可靠即时预警：[Vercel Cron 使用与价格](https://vercel.com/docs/cron-jobs/usage-and-pricing) · [Vercel Cron 管理与可靠性](https://vercel.com/docs/cron-jobs/manage-cron-jobs)。

## 12. 报警默认策略建议

预警应按事件性质分三类：

| 类别 | 状态 | 默认 | 方式 |
|---|---|---|---|
| 提前机会 | L2 临界接近、L3 突破试探 | 待验证后再决定默认 | 轻声音 + 系统通知，明确未确认 |
| 确认机会 | BREAKOUT_TRACK、RETEST_WATCH | 开 | 明显但单次声音 + 系统通知 |
| 风险 | REJECT、OVERHEATED | REJECT 开；OVERHEATED 关 | 柔和风险声，直接写具体原因 |
| 系统异常 | DATA_BLOCKED | 开 | 与机会不同的轻提示；必须显示最后可信时间 |
| 普通观察 | WATCH | 关 | 仅页面内显示 |

不要继续增加声音和 Pattern。先做到不同事件不同强度、相同事件不重复、数据恢复后能重新武装。

## 13. 报警噪声与漏报

当前 `symbol + episodeId + actionState` 能防重复轮询，但对预警系统并不完整：

- 同一状态离开后再次进入可能被永久压掉；
- 无 episode 的 DATA_BLOCKED 可能长期共用 `no-episode` 键，下一次独立故障不再提醒；
- 双币同时触发不会覆盖，但声音可能叠加；
- 首次打开会把当前存量状态当成一次变化；
- 请求直接失败时 catch 不建 Alert，可能静默失联。

建议机会事件按 Episode 去重；试探事件按短冷却合并；风险事件每个 Episode 一次；数据异常按 outage incident 去重，恢复后关闭，下一次故障重新允许；双币同时发生时合并成一次声音和一条摘要；增加每币每小时最大提醒数，超过后汇总。

## 14. 用户真实使用流程结论

早上打开页面并离开：当前只有在网页继续存活、轮询继续运行、声音已解锁或通知已授权时，用户才可能收到提醒。页面关闭后完全失效。

发生临界接近：当前没有经过验证的专门预警层，用户可能只看到 WATCH，或者直到 4H 收盘后才收到 BREAKOUT_TRACK。

发生真实突破：BREAKOUT_TRACK 能提醒，但最快受 60 秒轮询、数据缓存和浏览器后台调度影响。

发生回踩/失效：能够提醒；REJECT 需要区分结构失效、BTC 环境否决与数据问题。

发生数据故障：如果 API 返回 STALE/UNAVAILABLE，会 DATA_BLOCKED；如果请求完全抛错，可能无提醒。

PEPE/DOGE 同时触发：队列保留两条，但缺少合并和优先级，可能形成声音与弹层噪声。

刷新页面：Active/ACK/历史恢复；页面关闭：不再发现任何新行情。

## 15. 功能过度设计与应当简化的内容

已经过度设计：10 种声音、5 种 Pattern、5 个展示通道同时开放、Modal + Banner + Pulse 重复刺激。

应该保留但下沉：Action Card 的完整评分、Episode code、Hard Veto code、所有 Freshness 工程字段。

应该提升：首页最上方的“当前预警级别、距离关键位、数据可信度、下一次 4H 收盘时间、报警是否真正在线”。

UI 整改仍然需要做，但优先级低于数据采集、预警验证和服务端推送。

## 16. 下一阶段 P0 / P1 / P2

### P0｜预警研究与可靠性地基

1. 建立服务端 point-in-time 数据采集，不改变现有实时决策。
2. 补 OI、主动买卖量/CVD proxy、现货/永续量价、mark/index/premium、盘口深度。
3. OKX 主源 + Binance/Bybit 至少一个交叉源；建立字段级 freshness 和单位标准化。
4. 构建成功/失败/普通窗口的预警数据集，专门评估提前量、转确认率和每天误报数。
5. 修复完全请求失败静默、DATA_BLOCKED 重入、首次加载误报和双币声音叠加的产品语义。
6. 设计服务端事件存储、幂等去重、重试和推送状态记录。
7. 输出 `PRE_ALERT_DATA_PROTOCOL_V1`，由用户确认数据、标签、候选特征和验收指标后再写模型。

### P1｜经过研究后进入生产

1. 仅把证明有样本外增量的数据加入 L2/L3 预警。
2. 服务端持续监控 + Web Push；分钟级 Cron 只作健康兜底。
3. 加强强平、跨交易所一致性与数据恢复提醒。
4. 机会、风险、系统异常采用不同声音、通道、冷却和去重生命周期。
5. 首页以预警级别和报警在线状态为第一层，研究指标折叠。

### P2｜暂缓

1. 链上鲸鱼、交易所流入流出；
2. 社交热度、新闻和情绪数据；
3. 更多声音、Pattern、动效、历史筛选；
4. 手机端专项；
5. 扩展到 PEPE/DOGE/BTC 之外的币种。

## 17. 哪些功能现在不要做

- 不把 OI、CVD、盘口、强平直接加权成新分数；
- 不因为数据更多就宣称预警更准；
- 不把“突破试探”写成突破确认；
- 不把主动买卖量称作真实资金流入；
- 不使用 Success Rate、Precision、Recall 作为实时用户概率；
- 不继续扩充提醒外观；
- 不在没有服务端持续监控前宣称关页可报警；
- 不购买付费数据前先假设它一定带来增量价值。

## 18. 是否建议进入下一轮开发

**建议进入，但必须拆成“数据研究层”和“生产提醒层”，先研究、后生产。**

第一轮不是改 Action 状态，也不是加页面指标，而是完成数据采集协议、来源验证、历史存储和增量评估。只有当 OI、主动成交、现货/永续一致性或盘口证据在独立 holdout 中真正减少误报或增加提前量，才把它们接入用户预警。

同时可以并行设计服务端持续监控与 Web Push，但在送达率、幂等、故障降级和权限体验验证完成前，不宣称“可靠预警已经上线”。

## 19. 最终结论

`NEED_ADJUSTMENT`

当前产品已经具备可靠状态确认和页面内提醒的基础，但还没有足够的数据证据与后台监测能力支持“更加可靠的提前预警”。下一阶段最高优先级应是补齐 OI、主动买卖、现货/永续一致性、premium、盘口与跨交易所数据，建立专门的预警评价体系，再建设服务端持续监控与 Web Push。UI 简化是辅助项，不是主任务。
