# PRE_ALERT_DATA_PROTOCOL_V1｜提前预警数据采集协议（研究层冻结版）

> 版本：V1 ｜ 日期：2026-09-09（UTC）｜ 性质：**纯协议文档，不做模型、不改阈值/权重、不改业务代码**
> 依据：`PRODUCT_FUNCTION_REVIEW.md` §5–§7、§10、§16-P0；`EPISODE_ANALYSIS.md`、`NORMAL_WINDOW_ANALYSIS.md`、`LABEL_SENSITIVITY.md`、`BACKTEST_PROTOCOL_V1.md`
> 修订：V1-REV（SOL REJECT 意见逐项修订：HIGH-1~6、MEDIUM-1~2，§10 按 SOL 终裁落字）
> 修订：V1-REV2（SOL 二轮意见修订：HIGH-1 instrument identity / HIGH-2 Eligible Dataset / HIGH-3 预警事件生命周期 / HIGH-4 FIELD_FRESHNESS_POLICY / MEDIUM-2 source_event_id null 口径 / §10 终裁落字微调；纯协议文档，禁动业务代码）
> 修订：V1-REV4（SOL 三轮 REJECT 返修 5 项：R1 预确认去重键加 breakout_level_id / R2 Trade/Funding freshness 语义对齐 / R3 删残留未定义 L2 首触发术语 / R4 P0.0 probe 为 APPROVE 后 P0 第一步非前置门、授权单向无循环 / R5 审查包旧口径同步冻结；已通过项清单一字不改；纯协议文档，禁动业务代码禁commit禁push）
> 修订：V1-REV5（SOL 四轮 REJECT 返修 3 项：F 样本基线 README 同步 / G 审查包主审入口同步七项+P0五类 / H §5.4 tombstone 冻结消解 L290-L301 冲突；A-E/R1-R5 已落地一字不改；纯协议文档，禁动业务代码禁commit禁push）
> Gate：**本协议须先由用户确认，再写任何模型/特征/评分逻辑。本任务只出文档。**
> 约束：禁策略阈值/权重改动；禁手机端专项；禁胜率包装（研究指标仅离线，不进 ActionCard/实时信号/报警）。

---

## §0 范围与非目标（Scope）

### 0.1 标的范围

| 标的 | 角色 | 说明 |
|---|---|---|
| PEPE | 交易标的 | 主标的之一 |
| DOGE | 交易标的 | 主标的之一 |
| ETHFI | 交易标的 | 与 PEPE/DOGE 同框架接入；历史基线暂缺，相关字段缺省记 `unknown/missing`，禁编造；本协议仅做**前向采集**（见 §10-5），不纳入首轮增量评测 |
| BTC | 环境参照 | 仅作环境闸门与相对强度基准，不产生提前预警 |

不扩展到 PEPE/DOGE/ETHFI/BTC 之外的任何币种。

### 0.2 数据源范围

- **主源（Primary）：OKX 公共 REST + WebSocket**（价格、K 线、逐笔成交、Ticker、Books、OI、Funding History、Mark/Index、Premium）。无 Key，server-side 发起。
- **交叉源（Cross-check）：Binance USDⓈ-M Futures**（OI、funding、mark/index/premium、taker 统计、aggTrade、depth、现货/永续对照）。
- **出范围（本协议禁写其任何常量/端点/密钥/套餐假设）：Bybit、CoinGlass。** 文档中仅以名称提及作为"出范围"声明，不得出现其 API 路径、host、参数、symbol 映射表。
- 现有 `market-client.ts` 已有 `OKX_HOSTS` / `BINANCE_HOSTS` 双域名回退、`ASSETS` 唯一标的注册表；新采集必须复用该注册表，禁散落字面量 symbol。
- **Instrument Registry（强制）：** `1000PEPE` / `PEPE` 等合约单位差异必须走 instrument registry 的 canonical 归一（见 §2 通则），**禁在各处硬编码 multiplier 做换算**（首轮 HIGH-3/HIGH-4；二轮 HIGH-1 扩展为 instrument identity）。
- **Instrument Identity（二轮 HIGH-1）：** 所有 trade / price / volume / OI 记录必须绑定 instrument identity 三件套：`market_type`（`spot | perp`）+ `instrument_registry_key` + `instrument_registry_version`。同一交易所内 symbol 字符串相同但 market_type 不同者（如 Binance 现货与 U 本位永续的同名字符串）必须可区分，**禁仅以 symbol 字符串区分现货/永续**；`symbol_raw` 仅作原始透传，禁作跨市场 join 键。

### 0.3 非目标

- 不修改实时 Action / 状态机 / 阈值 / 权重 / M5。
- 不做手机端专项、不新增声音/动效。
- 不输出胜率/准确率承诺；§5 指标仅为离线研究诚实性证据。

---

## §1 最小五字段包（第一轮只收这 5 类）

> 对应 REVIEW §5 末"最小可行数据包"，按 SOL 终裁（MEDIUM-1）冻结为以下五类。
> **口径统一声明（与 §2 / README 一致）：** 第一轮 = OI / taker-CVD / 现货永续 / mark-index-funding-basis / 可靠性+跨市场健康。
> 突破位距离**复用现有**（Rolling42/突破位/距离，不新增采集）；OrderBook 只留字段定义、第一轮仅 P1 采集（§2 P1-A）；
> 强平（liquidation）为 P1（§2 P1-B），不进第一轮采集验证。

| # | 字段组 | 内容 | 用途 | 落点 |
|---|---|---|---|---|
| 1 | OI 包 | venue-aware `oi_notional_usd` + 各所原生保留字段（§2 P0-A） | 参与度/拥挤度证据 | §2 P0-A |
| 2 | 主动买卖包 | 5m/15m taker buy/sell、CVD proxy（§2 P0-B） | 区分真实参与 vs 价格噪声 | §2 P0-B |
| 3 | 现货/永续一致性包 | 同步成交量、价差、`spot_perp_dir_agree`（仅方向一致含义，禁因果外推，MEDIUM-2） | 识别单纯合约拉升 | §2 P0-C |
| 4 | Mark/Index/Funding/Basis 包 | `mark_price` / `index_price` / funding 当前+历史 / `mark_index_basis_pct`（原 premium 改名）；原生 `premium_index` 另存（MEDIUM-2） | 基差/费率组合证据 | §2 P0-E |
| 5 | 数据可信包 | 每源 event time、receive time、延迟、**Reliability（HEALTHY/DEGRADED/UNAVAILABLE）与 Cross-market（ALIGNED/DIVERGED）正交双状态**（HIGH-5） | 可信底座 | §2 P0-F、§3、§6 |

> 突破位距离包不在本表：复用现有 Rolling Breakout（`rollingHigh(t)=MAX(high[t-42..t-1])`、现价距突破位 %、接近速度、停留时间），不新增采集字段。

---

## §2 全量字段清单（P0-A~C/E/F 首轮；P1-A/B 延后）

> 单位与标准化规则为强制项。所有金额统一 **USDT notional（字段名统一 `*_notional_usd`）**；所有时间统一 **UTC 毫秒**；
> 价格执行 HIGH-4 三层存储（`price_native` / `price_canonical` / `canonical_base_asset` + `unit_scale`），**禁直接比较跨所 native 价**。
> 字段范围口径与 §1 / README 统一：首轮 P0-A/B/C/E/F；P1-A（OrderBook）/P1-B（强平）留字段、延后采集。

### §2 通则（HIGH-3 / HIGH-4 全局适用）

1. **Venue-aware OI（否决通用公式）：** 通用公式 `oi_raw × mark_price × contract_multiplier` **否决作废**，任何新代码/文档禁再引用它作为 OI 口径（§10-6）。
   统一输出口径为 **`oi_notional_usd`**，由各所独立 adapter 产出：
   - OKX adapter：**优先采用官方 `oiUsd`**；同时保留原生 `oi`（张数）、`oiCcy`、官方返回 metadata（`instId/instType/ts` 等），同行存储备查。
   - Binance adapter：保留原生 `openInterest`（及官方 OI value 字段），由 Binance adapter **内部**转 `oi_notional_usd`；禁跨所复用 OKX 的换算路径。
2. **Instrument registry canonical 归一：** `1000PEPE` / `PEPE` 等单位差异一律走 instrument registry 的 canonical 定义归一到 notional；**禁硬编码 multiplier**（禁在业务代码/脚本/文档里散落 `×1000` / `×0.001` 常量）。
3. **价格三层（HIGH-4）：** 每条价格记录必带 `price_native`（交易所原始值）+ `unit_scale`（该 instrument 的 native→canonical 缩放声明，取自 registry，非手写常量）+ `price_canonical`（归一到 `canonical_base_asset` 后的可比价）+ `canonical_base_asset`（如 `PEPE`）。
   **禁直接比较 OKX PEPE 与 Binance 1000PEPE 的 native 价**；跨所价差只允许在 `price_canonical` 上计算（`price_diff_bps` 见 P1-C/§6）。
4. 旧 §2 P0-A 中 `oi_raw` / `oi_notional` / `contract_multiplier` 口径随本通则作废，以本节为准。
5. **Instrument identity 绑定（二轮 HIGH-1）：** 所有 trade / price / volume / OI 记录必须绑定 `market_type`（`spot | perp`）+ `instrument_registry_key` + `instrument_registry_version`（Schema 见 §3.2）；同一交易所内 symbol 字符串相同但 market_type 不同者必须可区分（Binance 现货 vs U 本位永续同 symbol 字符串禁混同）；`symbol_raw` 仅透传、禁作 join 键。

### P0-A｜Open Interest 及其变化（首轮，venue-aware）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `oi_notional_usd` | USD notional | **统一输出口径**，由各所 adapter 按 §2 通则产出；跨所比较只允许比较此字段 |
| `oi_native` + `oi_native_unit` + `oiCcy` + `oi_metadata` | 各所原始 | OKX：官方 `oi` + `oiCcy` + `oiUsd` + metadata 同行保留；Binance：原生 `openInterest`（+官方 OI value）同行保留；原始值永久保留、派生可重算 |
| `oi_source` | 枚举 `okx/binance` | 每条记录必带；OKX 与 Binance 分开存，不做跨所平均后丢源 |
| `oi_chg_15m / oi_chg_1h / oi_chg_4h` | % | `(oi_notional_usd_t - oi_notional_usd_{t-w}) / oi_notional_usd_{t-w} × 100`，分母为 0/缺失记 `null` |
| `oi_notional_chg_usd` | USD | 同窗口 `oi_notional_usd` 差值 |
| `price_oi_combo` | 标签 | 仅记录原始组合（涨+OI升/涨+OI降等），**禁解释为看涨分** |

### P0-B｜主动买卖与 CVD proxy（首轮）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `taker_buy_vol / taker_sell_vol`（5m/15m/1h） | 币 canonical 数量 + 同步 USDT notional | 由逐笔成交 `taker side` 聚合；先按 1m 落库再上卷到 5m/15m，保留 1m 明细以便重算；数量统一到 canonical base asset（HIGH-4） |
| `taker_bs_ratio` | 比值 | `buy / sell`；sell=0 记 `null`，禁记 0/无穷 |
| `cvd_proxy` | 累积差（USDT） | `Σ(buy_notional - sell_notional)`，窗口起点归零并记录起点 ts |
| 口径声明 | — | 交易所成交方向仅为撮合层代理，**不等同真实资金净流入、不等同上涨概率**，文档与后续研究报告必须带此声明 |

### P0-C｜现货与永续参与一致性（首轮）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `spot_vol / perp_vol` | USDT | OKX Spot + Swap 分开存；Binance Spot + USDⓈ-M 分开存 |
| `spot_perp_vol_ratio` | 比值 | 同窗口 `spot_notional / perp_notional` |
| `spot_price_native / perp_mark_native / perp_index_native` + `price_canonical` 三价 | 原生 + canonical | 三价同 ts 对齐存；原生禁直接跨所比较，比较只用 canonical（HIGH-4） |
| `spot_perp_dir_agree` | 布尔/null | **仅代表"现货主动买入与永续主动买入方向一致"这一观测事实；禁因果外推**（禁写成"现货带领/验证合约"等因果表述，MEDIUM-2）；任一缺失为 null |

### P0-D｜（编号保留占位，本版无内容；OrderBook 见 P1-A，强平见 P1-B）

> 为避免与历史版本 P0-D（盘口）混淆，本版 P0-D 留空占位。盘口深度统一见 **P1-A**，强平统一见 **P1-B**，均不在首轮采集验证范围内。

### P0-E｜资金费率 + Mark/Index + Basis 完整组合（首轮）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `funding_current / funding_history` | 原始比例（未×100） | 同时保留当前值与历史序列 |
| `next_funding_time` | UTC ms | 下一次 funding 时间，每条 funding 记录必带 |
| `mark_price / index_price`（native + canonical） | 计价货币 | 与 funding 同 ts 对齐；跨所比较只用 canonical（HIGH-4） |
| `mark_index_basis_pct` | % | `(mark - index) / index × 100`；**原 `premium / basis` 统一改名至此**（MEDIUM-2），历史文档中的 premium 一律按此重命名理解 |
| `premium_index_native` | 各所原始 | 交易所原生 `premiumIndex` 另存备查，禁与 `mark_index_basis_pct` 混用（MEDIUM-2） |
| `funding_cross_diff_pp` | pp | `funding_cross_diff_pp = (okx_raw - binance_raw) × 100`（均为原始比例未×100的值；任一缺失记 `null`，MEDIUM-2）；禁以单源值冒充差值 |
| 组合声明 | — | funding 单独信息有限，必须与 OI/premium/价格速度组合解读；禁单独做多空分 |

### P0-F｜可靠性 + 跨市场健康（首轮，HIGH-5 正交双状态）

| 字段 | 取值 | 规则 |
|---|---|---|
| `reliability` | `HEALTHY / DEGRADED / UNAVAILABLE` | 单源自身健康；**degrade 只允许由以下触发**：stale（分字段 freshness 过期）、timeout、bad payload（schema/类型非法）、timestamp 异常（event_time 倒退/漂移超限）、heartbeat 缺失、sequence gap（WS 序列缺口且 REST 未补齐前）。**禁因跨所价差单独降级 reliability** |
| `cross_market` | `ALIGNED / DIVERGED` | 双源都 HEALTHY 时的跨市场一致性；任一源非 HEALTHY 时记 `null`（不评 cross，避免单源故障污染跨市场结论） |
| `cross_event` | `CROSS_MARKET_DIVERGENCE / null` | 双健康但 canonical 价差命中候选阈值时，只记事件标签，**禁自动判数据错误、禁自动判任一源不可信**（HIGH-5） |
| 候选阈值与确认 | 50bps + 连续 2 周期 | `price_diff_bps ≥ 50` 仅为 **divergence 候选阈值**，须**连续 2 个采集周期**仍命中才标 `DIVERGED`；单周期命中只记候选不翻转状态 |

### P1-A｜盘口流动性与突破位附近深度（字段定义先行，第一轮采集暂缓验证）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `best_bid / best_ask / spread_bps` | 价格 / bps | 快照 ts 必带；spread = `(ask-bid)/mid × 10000`，mid 用 canonical 价 |
| `depth_bid_0p5 / depth_ask_0p5 / depth_bid_1p0 / depth_ask_1p0` | USDT | 距现价 ±0.5%/±1% 档位加总；只存聚合深度，禁把单次大挂单当事实 |
| `ask_wall_above / bid_wall_below` | USDT | 突破位上方卖盘厚度 / 结构失效位下方买盘厚度 |
| `depth_persist_s` | 秒 | 深度连续存在时长，用于抗 spoofing（单次快照禁做信号） |
| `est_slippage` | bps | 假设下单金额下的估算滑点，并记录假设金额 |

### P1-B｜强平数据（同步/滞后风险证据，不做最早触发器；延后采集）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `liq_long_usdt / liq_short_usdt` | USDT | 多空分开，方向+时间+交易所必带 |
| 定位声明 | — | 仅用于解释突破/急跌是否伴随 forced flow，禁作最早触发器（本协议无分级，统计只用 §5.2/§5.4/§10 冻结术语） |

### P1-C｜跨交易所价格与成交一致性（计算口径说明；健康判定见 P0-F/§6）

| 字段 | 单位 | 标准化规则 |
|---|---|---|
| `price_diff_bps` | bps | 同一时刻 OKX vs Binance 永续 **canonical 价**差（HIGH-4；禁 native 直算） |
| `vol_chg_agree / oi_chg_agree / funding_agree` | 布尔/null | 变化方向是否一致 |
| `single_source_flag` | 布尔 | 仅一所出现异动时置 true，降级为"单源异动"，禁按全市场突破处理 |
| 各源 `event_time / receive_time / reliability` | UTC ms / 枚举 | 见 §3 双 freshness + §6 正交状态 |

---

## §3 采集设计（server-side research store）

### 3.1 总则

- 新增数据**只进 server-side research store**，实时 Action **禁止消费**本协议任何新字段（代码门控：不 import 新 store 到 `market-service.ts`/`v2/engine.ts`/`action.ts`）。
- 原始值与派生指标分开存储，派生可重算。

### 3.2 记录 Schema（每条必备，HIGH-6 修订版）

```
{
  exchange: 'okx' | 'binance',   // 来源
  symbol_raw: string,            // 交易所原始 symbol（如 1000PEPEUSDT / PEPE-USDT-SWAP，仅透传，禁作 join 键）
  symbol_norm: 'PEPE'|'DOGE'|'ETHFI'|'BTC',
  // --- 二轮 HIGH-1 instrument identity（trade/price/volume/OI 记录必填） ---
  market_type: 'spot'|'perp',       // 现货 / 永续（同 symbol 字符串必须可区分）
  instrument_registry_key: string,  // instrument registry 主键（示例格式，如 BINANCE-PERP-PEPEUSDT，具体命名由 registry 实现冻结）
  instrument_registry_version: string, // registry 版本（归一逻辑变更必须 bump）
  // --- HIGH-4 价格/单位三层（价格类记录必填；非价格类记 null） ---
  price_native: number|null,     // 交易所原始价格（禁跨所直接比较）
  unit_scale: string|null,       // native→canonical 缩放声明（取自 instrument registry，如 1000PEPE→PEPE）
  price_canonical: number|null,  // 归一到 canonical_base_asset 的可比价
  canonical_base_asset: string|null, // 如 PEPE / DOGE
  field: string,                 // 字段名（§2）
  value_raw: number|string,      // 原始值
  value_norm: number|null,       // 标准化值（notional/UTC ms/比率；OI 统一 oi_notional_usd）
  event_time_ms: number|null,    // 交易所事件时间（禁拿抓取时间冒充）
  receive_time_ms: number,       // 本端收到时间
  // --- HIGH-6 新增溯源/版本字段（二轮 MEDIUM-2 修订 source_event_id 口径） ---
  source_event_id: string|null,  // 仅当交易所有原生事件 ID 时填写（如 tradeId / updateId；无原生 ID 一律 null，禁编造、禁把源 ts 映射冒充原生 ID）
  source_sequence: number|null,  // 交易所原生序列号（depth sequence / WS seq；无则 null）
  channel: string|null,          // 采集通道：ws / rest / rest-backfill
  snapshot_id: string|null,      // 周期快照批次 ID（同一轮采集共享，REST 回补沿用原 snapshot_id + channel=rest-backfill）
  schema_version: string,        // 记录 schema 版本（如 1.1.0）
  collector_version: string,     // 采集器版本
  normalizer_version: string,    // venue adapter / normalizer 版本（OI 与价格归一逻辑变更必须 bump）
  // --- 健康与 freshness ---
  reliability: 'HEALTHY'|'DEGRADED'|'UNAVAILABLE', // HIGH-5 单源健康（替代旧 freshness 枚举）
  cross_market: 'ALIGNED'|'DIVERGED'|null,         // HIGH-5 跨市场状态（本条为快照级；单源非健康记 null）
  freshness: 'ok'|'stale'|'unavailable',  // 保留：分字段 freshness 原始判定（与 reliability 映射关系见 §6-2）
  error_code: string|null,       // 分类错误码（timeout/dns/network/http_status/bad_body/none）
  is_backfill: boolean,          // 是否 REST 回补/补录（true 时 channel 必须为 rest-backfill）
  dedup_key: string,             // 去重键（见 §6-7 冻结语义）
  source_diag: object            // 复用 market-client FetchDiag 口径
}
```

### 3.3 复用现有能力（只读调研结论，见 §8）

- 复用 `market-client.ts` 的 `fetchWithFallback`（双域名回退）、TTL 缓存、inflight 去重、`FetchDiag` 诊断、`Result<T>` 口径。
- 复用 `freshness.ts` 的 `assessCandleFreshness` / `assessFeedFreshness` 思想，但新字段必须**分字段独立 freshness**，禁复用 K 线 freshness 冒充 OI/trades freshness。
- 新 store 与 `data-store.ts`（历史快照）物理隔离：快照只读、不被实时覆盖；研究 store 独立表/目录。
- **Normal 窗口 generator 复用冻结实现**：`buildNormalWindows`（固定 48H / stride 48H / 无重叠 / 窗口内无 episode start 即 Normal），新采集验证禁另写窗口切分逻辑（HIGH-2）。

---

## §4 窗口与样本设计（禁幸存者偏差）

### 4.1 时间窗口粒度

`1m / 5m / 15m / 1h / 4h` 五档。trades 级先按 1m 落库，再上卷；OI/funding/mark 按源更新频率原样落库 + 重采样对齐；orderbook 只存周期快照+聚合深度。

### 4.2 四类窗口（必须全有；HIGH-1/HIGH-2 冻结口径）

> **旧口径作废声明：** 「全量突破扫描 217（成功 75 / 失败 142）」为旧 raw-cooldown 口径，
> 本协议正文禁再引用该组数字作为样本基线；凡引用必须同时注明口径且指向本节冻结口径。
> 研究分析单位固定为 **Independent Episode**，禁拿 raw trigger 直接当独立样本。

| 类别 | 定义 | 冻结基线 |
|---|---|---|
| 成功突破（Episode） | Independent Episode + 冻结标签：**72H MFE ≥ 10% AND MAE ≥ −8%**（`FROZEN_SUCCESS_LABEL`；`BACKTEST_PROTOCOL_V1.md` + `LABEL_SENSITIVITY.md`） | **41**（116 episodes 中冻结标签 success） |
| 失败突破（Episode） | Independent Episode + 未命中上述 AND 标签 | **75**（116 − 41） |
| Raw Trigger（仅作膨胀证据，禁当样本） | detector `lookback=42`、仅已收盘 4H、`close > rollingHigh` 下的原始触发计数 | PEPE **140** + DOGE **150** = **290**；Independent Episode PEPE **59** + DOGE **57** = **116**（膨胀比约 2.5x；`EPISODE_ANALYSIS.md` Hybrid-D 冻结规则） |
| 普通窗口 | 冻结 generator：固定 **48H**（12 根 4H）、**stride 48H**、无重叠、窗口内无 episode start（`buildNormalWindows`，TEST 8/9） | PEPE **383（379 可评）** / DOGE **385（381 可评）** / 合计 **768（760 可评）**（`NORMAL_WINDOW_ANALYSIS.md`）；旧"≥30 天间隙 12 个（PEPE 5 / DOGE 7）"是另一概念，禁与本表混用 |
| 异常窗口 | 数据断流/单源异动/STALE/UNAVAILABLE 段 | 每次 outage 独立建事件，恢复后关闭；禁与成功样本混算指标 |

### 4.3 point-in-time 铁律

- 特征只能吃当刻已收盘/已到达数据；未来 K 线/MFE 只做标签。
- Campaign 级 walk-forward：同一 campaign 永不跨 train/test（沿用 `v2/protocol.ts` FROZEN 精神）。

### 4.4 Eligible Dataset（二轮 HIGH-2：新字段实验的合格数据集口径）

1. **Historical Label Universe（历史标签全集，仅作标签宇宙）：** 116 Independent Episodes + 760 可评 normal 窗口仅为历史标签全集（`historical_universe_episode_n = 116` / `historical_universe_normal_n = 760`），新字段实验禁直接以其为分母报指标。
2. **新字段实验强制报告项：** `historical_universe_episode_n` / `historical_universe_normal_n` / `eligible_episode_n` / `eligible_normal_n` / coverage 起止（UTC ms）/ `coverage_pct` / `missing_by_field` / `missing_by_source`。
3. **Eligible（合格子集）定义：** 仅 coverage 窗口内且所需字段齐全的 Episode / normal 窗口可进分母；无该字段的 Episode 禁进分母。
4. **三禁：** 禁用未来数据补历史（禁未来补历史）；禁 missing 当 0；禁把无字段 Episode 计入分母。
5. **§5.1 分母口径：** 全集口径声明 + feature-complete（eligible）子集实评并列，二者必须同时报告，禁只报其一。

---

## §5 增量研究问题与验收指标

### 5.1 逐项增量问题（每个候选数据独立回答；分析单位 = Independent Episode；分母口径按 §4.4：全集口径声明 + feature-complete 子集实评并列）

1. 加 OI（venue-aware `oi_notional_usd`）后，比"仅价格距离+量比"少了多少误报？（分母按 §4.4：历史标签全集 116 episodes + 760 可评 normal 仅作 universe 声明，实评以 eligible / feature-complete 子集为分母并并列报告全集口径）
2. 加主动买卖后，突破前提前量 / 确认转化是否提升？
3. 加现货/永续一致性后，能否识别单纯合约拉升？（`spot_perp_dir_agree` 只记方向一致事实，禁因果表述）
4. 加盘口深度后，效果是否稳定还是只在少数事件有效？（P1-A 延后，本问题首轮不验收）
5. 加跨所一致性后，是否减少单源异常误报？（以 `CROSS_MARKET_DIVERGENCE` 事件为单位统计，禁把价差直接记成数据错误）

### 5.2 验收指标（离线研究用，不进实时 UI 概率表述）

> 术语冻结（HIGH-3）：本节禁使用 `L2/L3` 分级统计术语。预警统计只用以下三项冻结定义；任何分级（L1/L2/L3 或其他）以后另开协议，本协议禁预设分级口径。

| 指标 | 定义 |
|---|---|
| 提前量（LEAD） | `LEAD = confirmed_ts - warning_active_ts`（仅 `4H_CONFIRMED` 事件可算；未确认不算 LEAD）；按 §10-1 SOL 终裁统计（median ≥ 30min，且强制报告 P25 / 信号比 / 捕获率） |
| 捕获率（Capture） | `分母 = 全部 4H_CONFIRMED 事件数`，`分子 = 其中曾进入过 EARLY_WARNING_ACTIVE 者`；即确认事件中曾被预警覆盖占比（§10-1 强制并列报告，禁只报提前量中位数） |
| 预警转确认率（Warning→Confirm） | `分母 = 全部进入 EARLY_WARNING_ACTIVE 事件数`，`分子 = 其中最终转 4H_CONFIRMED 者`；即 ACTIVE 转确认占比 |
| 误报负担（FALSE） | 按 §10-2 SOL 终裁：**1 / 币 / 天、7 天滚动**，并报告 daily p95 |
| 重复提醒数 | 同一 prealert_cycle（同 `symbol_norm + structure_id + breakout_level_id + target_confirmation_close_ts`，R1 冻结）平均提醒次数 |
| 撤销速度 | 预警失效后多久通知用户 |
| 弱市表现 | 分 campaign / 分市场环境稳定性 |
| 数据可用率（UPTIME） | 每源 uptime、延迟、缺口、交叉不一致率；按 §10-4 SOL 终裁统计（50bps 价差禁直接降级 reliability；按 exchange×field 独立统计） |
| 送达可靠性（DELIVERY） | 按 §10-3 SOL 终裁：以 `source_event_time → alert_received_time` 全链路统计服务端检测延迟、推送成功率、重复率、漏发率 |

### 5.3 SLO 冻结值（SOL FROZEN DECISIONS，见 §10）

`SLO_LEAD_MIN / SLO_FALSE_PER_DAY / SLO_DELIVERY_P95 / SLO_UPTIME` 四项数值按 §10 SOL FROZEN DECISIONS 落字执行，不留空、不设 TBD；统计口径按 §10-1~4 SOL 终裁执行。

### 5.4 Early Warning Event Lifecycle Contract（二轮 HIGH-3；三轮 HIGH-1/HIGH-3/HIGH-7 修订；只定状态与统计口径，不涉及权重评分）

状态机：`PRE_ALERT_CANDIDATE → EARLY_WARNING_ACTIVE → 4H_CONFIRMED | INVALIDATED | EXPIRED`。

| 字段 | 含义 |
|---|---|
| `prealert_id` | 预警事件唯一 ID，**独立创建**（创建时即分配，禁由未来 Episode 派生、禁以 Episode ID 拼装；三轮 HIGH-1） |
| `prealert_cycle_id` | 预警轮次 ID（同一 `symbol_norm + structure_id + breakout_level_id + target_confirmation_close_ts` 下的去重轮次；同一轮次内重复触发禁建新 `prealert_id`，含终态后 tombstone 期内，见下条冻结） |
| `target_confirmation_close_ts` | 目标确认收盘 ts（UTC ms；= warning 所在形成中 4H 的**下一收盘边界**，HIGH-7 冻结；创建时即冻结，禁事后改写） |
| `structure_id` | 结构 ID（突破结构/突破位定义的稳定标识；与 `breakout_level_id` 共同定位同一结构） |
| `breakout_level_id` | 突破位 ID（具体价位/level 标识；同一 structure 下不同 level 为不同轮次） |
| `first_candidate_ts` | 首次进入 CANDIDATE 时间（UTC ms；仅记录，禁作 LEAD 起点） |
| `warning_active_ts` | 进入 ACTIVE 时间（UTC ms；**LEAD 起点**） |
| `confirmed_ts` | 进入 `4H_CONFIRMED` 时间（UTC ms；未确认记 null） |
| `invalidated_ts` | 进入 `INVALIDATED` 时间（UTC ms；未失效记 null） |
| `expired_ts` | 进入 `EXPIRED` 时间（UTC ms；未过期记 null） |
| `linked_episode_id` | 关联的 Independent Episode ID（**只许进入 `4H_CONFIRMED` 后回填**；未确认一律 `null`，禁预填、禁以候选关联冒充确认关联） |

- **预确认去重键 + 单 prealert 冻结（HIGH-1 冻结，R1 修订，REV5 tombstone 冻结；本条效力高于本节旧"仅未终结禁建"字样）：** `symbol_norm + structure_id + breakout_level_id + target_confirmation_close_ts`。同一键整个 cycle 最多一个 `prealert_id`（含终态后 tombstone 期内）：同一键已存在 prealert（无论未终结还是已进终态但 tombstone 未过期）禁新建 `prealert_id`，只允许更新同一 `prealert_cycle_id` 下的状态/时间戳。**键内禁含任何未来 Episode 身份**（禁 episode_id / 禁未来标签回写，`linked_episode_id` 只许确认后回填、不参与去重）。
- **终态 tombstone 冻结（REV5，消解 L290-L301 冲突）：** 进入终态（`4H_CONFIRMED` / `INVALIDATED` / `EXPIRED`）后保留 tombstone 至 `target_confirmation_close_ts + CANDLE_FRESHNESS_GRACE_MS（15min）`；tombstone 期内禁同键同 cycle 重建（重建 = 重复提醒 + FALSE 重计数）。re-arm 如需另行定义，必须走可执行新键规则（新 `target_confirmation_close_ts` / 新 `breakout_level_id` 即新键），本次优先 tombstone 方案，同 cycle 旧键禁复活。
- **禁未来 Episode 去重（HIGH-1）：** `prealert_id` 独立创建；**禁任何预警逻辑用未来 Episode 去重查找**（禁以"是否存在未来 Episode"决定是否建预警、禁以 Episode 去重键反查/合并预警、禁以未来标签回写预警去重）。`linked_episode_id` 只许确认后回填，属事后关联，不参与任何预警去重/触发判定。
- **LEAD 起点与定义（HIGH-3 冻结）：** `LEAD = confirmed_ts - warning_active_ts`。以 `warning_active_ts` 为起点（`warning_active_ts → 4H 确认 ts`），禁以 `first_candidate_ts` 起算；禁使用 L2/L3 起算口径。
- **FALSE 定义：** 进入 `EARLY_WARNING_ACTIVE` 后未转 `4H_CONFIRMED`、而进入 `INVALIDATED` / `EXPIRED` 者记 1 次 FALSE（§10-2 口径的事件单位）。
- **Expiry 窗口（HIGH-7 冻结）：** `target_confirmation_close_ts = warning 所在形成中 4H 的下一收盘边界`；至 `target_confirmation_close_ts + CANDLE_FRESHNESS_GRACE_MS（15min）` 仍未确认且未 `INVALIDATED`，则判 `EXPIRED` 并记 1 次 FALSE。**禁 Builder 自选固定 expiry**（禁自猜 N 分钟/ N 小时窗口、禁以缺省值自动判 `EXPIRED` 消费之外的任何窗口）。
- **范围声明：** 本契约只定事件状态与统计口径，不涉及任何权重/评分/阈值改动；分级统计以后另开协议。

---

## §6 可靠性 8 条（HIGH-5/HIGH-6 修订版；二轮 HIGH-4 新增 §6-0 集中表；三轮 HIGH-4/HIGH-5 修订）

### §6-P0.0 SOURCE CHARACTERIZATION（三轮 HIGH-4 新增；REV4：P0 内已批准第一步，非 SOL 前置门）

1. **先 probe，后评测：** SOL APPROVE（见 §7）后 P0 建设的第一步即建**非评测 probe**做连续观测（建议 ≥ 24h），输出 `SOURCE_CADENCE_BASELINE_V1.md` 并冻结以下六项：`collector_poll` / `expected_source_update` / `heartbeat` / `stale_after` / `unavailable_after` / `recovery`（按 exchange×field 独立冻结）。probe 本身为已批准工作，**不需另行批准、不构成 SOL 前置门**。
2. **冻结前禁正式 forward evaluation（不禁 probe）：** `SOURCE_CADENCE_BASELINE_V1.md` 冻结前，禁启动正式 forward evaluation；§6-0 表中 `cadence_*` 绝对值在冻结前一律视为未定，禁以猜测值代入 `stale_after / unavailable_after` 判定。**被禁的是 forward evaluation，不是 probe。**
3. **probe 数据禁入评测：** probe 观测期数据只用于冻结 cadence 基线，**禁计入任何评测分母/指标**（禁入 §4.4 Eligible、禁入 §5.2 统计）。
4. **冻结后执行：** 冻结后 §6-0 按基线值执行；基线变更必须重新走 probe + 更新基线文件版本，禁口头改数。

### §6-0 FIELD_FRESHNESS_POLICY 集中表（二轮 HIGH-4；三轮 HIGH-4/HIGH-5 修订）

> `cadence_*` 绝对值以 `SOURCE_CADENCE_BASELINE_V1.md` 冻结值为准（见 §6-P0.0）；倍数关系本协议冻结。
> **冻结 2 周期对应 cadence：** §6-3 / P0-F 的"连续 2 个采集周期" = 2×对应字段 `cadence`。

| field | collection_mode | expected_update_interval | heartbeat_timeout | stale_after | unavailable_after | recovery_condition |
|---|---|---|---|---|---|---|
| oi | rest-poll | `cadence_oi`（源 OI 端点更新节拍，基线冻结） | 2×`cadence_oi` 无响应 | event age > 2×`cadence_oi` | event age > 4×`cadence_oi` 或连续 heartbeat 超时 | 新 OI 事件到达且 `event_time` 前进 |
| trades（逐笔/CVD 聚合） | ws（+ rest-backfill） | 连续事件流（`cadence_trade` = 1m 聚合节拍、仅用于上卷与回补对齐，**禁用于 stale 判定**，基线冻结） | WS 无消息超 `heartbeat_timeout_trade` | **transport 存活时禁以 Market Event Age 判 stale**（无新成交仍 `HEALTHY`，见下条）；transport 断线/心跳超时即 `stale` | transport 断线 + 回补失败 | WS 重连 + 序列缺口补齐 |
| mark / index | ws（+ rest 回退） | `cadence_mark`（源 mark/index 推送节拍，基线冻结） | 2×`cadence_mark` 无响应 | event age > 2×`cadence_mark` | event age > 4×`cadence_mark` 或连续 heartbeat 超时 | 新 mark/index 事件到达且 `event_time` 前进 |
| funding_current（当前费率） | rest-poll | `cadence_funding_current`（实际采集 cadence，基线冻结；三轮 HIGH-5） | 2×`cadence_funding_current` 无响应 | event age > 2×`cadence_funding_current` | event age > 4×`cadence_funding_current` 或连续 heartbeat 超时 | 新 funding_current 到达且 current 源实际更新时间或 `event_time` 前进（此处 `fundingTime` 指当前费率记录的事件时间、非结算目标时间）；`next_funding_time` 只表结算边界、禁作恢复依据 |
| funding_history（历史序列） | rest-poll | 按 settlement 对齐（`cadence_funding_history` = funding 结算周期，基线冻结；三轮 HIGH-5） | 2×`cadence_funding_history` 无响应 | event age 超过 2 个 settlement 周期未更新 | event age 超过 4 个 settlement 周期或连续 heartbeat 超时 | 新 funding 历史记录到达且 `fundingTime` 前进 |

- **无新 trade ≠ Trade Feed stale（R2 冻结，效力高于 §6-0 trades 行事件年龄字样）：** 低波动期无成交是正常市场状态。Trade Feed 必须区分 **Transport Liveness**（WS 连接/心跳存活）与 **Market Event Age**（最新成交事件时间）：transport 存活但无新成交 → 仍 `HEALTHY`（事件年龄再大也禁判 stale，`cadence_trade` 不参与 stale 判定）；transport 断线/心跳超时 → 按 heartbeat 路径降级（stale → unavailable）。
- **funding current/history 双 policy 一致性声明（R2 冻结）：** 两行倍数关系一致（stale = 2×基准、unavailable = 4×基准或连续 heartbeat 超时），判定基准不同且禁混用——current 基准为**实际采集 cadence**（`cadence_funding_current`，rest-poll 节拍）；history 基准为 **settlement 周期**（`cadence_funding_history`）；两行均经 §6-2 同一映射进 `reliability`。
- OI / trades / mark-index / funding 四行分开判定，禁跨字段复用 freshness（沿用 §3.3 分字段独立原则）。

1. **双时间戳**：每字段保留 `event_time_ms` + `receive_time_ms`，禁把抓取时间冒充市场时间；DELIVERY 统计以 `source_event_time → alert_received_time` 为全链路口径（§10-3）。
2. **分字段 freshness → Reliability 映射**：每源每字段独立 freshness（禁因 OKX 价格正常就把 Binance OI 视为正常）；
   映射：`ok → HEALTHY`；`stale → DEGRADED`；`unavailable → UNAVAILABLE`。**50bps 跨所价差禁参与此映射**（价差只走 cross_market，见第 3 条）。
3. **正交双状态（HIGH-5）**：`reliability`（单源自身）与 `cross_market`（双源一致性）正交独立。
   双 HEALTHY 下出现 canonical 价差只记 `CROSS_MARKET_DIVERGENCE` 事件，**禁自动判定任一源数据错误、禁自动降级 reliability**。
   `cross_market` 翻转条件：`price_diff_bps ≥ 50` 仅为候选阈值，须**连续 2 个采集周期**命中才标 `DIVERGED`。
4. **原始/派生分离**：原始值永久保留，派生可重算；symbol + instrument registry 引用 + OI 原生字段（`oi/oiCcy/metadata`）同行存储；价格执行 HIGH-4 三层。
5. **断线重连 + REST 回补幂等**：WS 断线重连、序列缺口检测（`source_sequence` gap）、REST 回补并置 `is_backfill=true` + `channel=rest-backfill`；
   回补沿用原 `snapshot_id`，按 §6-7 去重键幂等写入，禁产生重复记录。
6. **合约单位标准化（venue-aware）**：OI 统一走 §2 通则 venue-aware adapter + instrument registry canonical 归一；
   通用 `oi_raw × mark × multiplier` 公式已否决；**禁硬编码 multiplier**。价格跨所比较只用 `price_canonical`。
7. **去重键 + 幂等（冻结语义，HIGH-6；二轮 MEDIUM-2 修订 source_event_id 口径；三轮 HIGH-2 修订为 instrument_registry_key）**：服务端记录 `dedup_key`、状态版本、推送结果，支持幂等重试；
    去重语义冻结如下，WS 与 REST 回补共用同一语义（**`symbol_norm` 只作分析维度，不用作唯一身份**；唯一身份一律 `exchange + instrument_registry_key + 原生事件标识`）：
    - trade：`exchange + instrument_registry_key + tradeId`（`source_event_id` = tradeId，原生 ID，可填）；
    - OI：`exchange + instrument_registry_key + 源ts`（`source_event_id` 保持 `null`——源 ts 仅用于去重键，**禁冒充原生 ID**；`event_time_ms` 对齐源 ts）；
    - funding：`exchange + instrument_registry_key + fundingTime`（`source_event_id` 保持 `null`，fundingTime 仅用于去重键）；
    - depth：`exchange + instrument_registry_key + sequence/updateId`（`source_sequence` 必带；有原生 updateId 才填 `source_event_id`，否则 null）。
    机会事件按 §5.4 预确认去重键（`symbol_norm + structure_id + breakout_level_id + target_confirmation_close_ts`，R1 冻结）去重，异常按 outage incident 去重；**禁任何预警逻辑用未来 Episode 去重查找**（见 §5.4）。
8. **失败建异常事件**：数据完全失败必须触发系统异常事件（含错误码+起止 ts），**禁因 fetch 抛错而静默**；恢复后关闭事件，下一次故障重新允许。
   触发条件仅限 reliability 侧（stale/timeout/bad payload/timestamp/heartbeat/sequence gap），禁以跨所价差单独建"数据错误"异常。

---

## §7 Gate：协议先行，模型后行（三轮 HIGH-6 授权链统一）

1. 授权链（REV4 单向，循环已解）：**SOL APPROVE = Gate 通过、可进 P0 建设**（三轮 HIGH-6）。本协议 Gate 通过（§1/§2/§4/§5/§6 口径 + §10 七项冻结，**不含 P0.0 基线值**）即视为 SOL APPROVE，允许进入 P0 建设；§6-P0.0 probe 为已批准 P0 建设的第一步（非前置门），基线冻结后才启动正式 forward evaluation。链条单向：用户确认协议 → SOL APPROVE → P0 建设（probe → 基线冻结 → forward evaluation），无循环；不另设"待用户拍板"中间态，本协议内无 TBD。
2. 本协议由用户确认（数据范围、字段口径、§10 FROZEN DECISIONS 七项数值）后，才允许写模型/特征/评分。
   **确认项清单（SOL 终裁对应）：** §1 首轮五项范围；§2 venue-aware OI + 价格三层 + 正交双状态 + Schema/去重语义（instrument_registry_key）；
   §4 冻结样本基线（116 episodes / 41-75 / 768 normal）+ Eligible 口径；§5.4 生命周期（独立 prealert_id + 预确认去重键含 breakout_level_id + Expiry 冻结）；§6-P0.0 probe 方案（含基线文件六项清单与冻结流程，绝对值待基线冻结）+ §6-0 双 funding freshness；§10 七项 SOL FROZEN DECISIONS。
3. 本任务交付物仅为本文档；任何模型改动需新任务另批。
4. 阈值/权重/状态机零改动举证：本任务未触碰 `src/` 下任何业务文件（只读调研）。

---

## §8 现有模块只读调研与复用度（re-use）

| 模块 | 现状 | 复用结论 |
|---|---|---|
| `src/lib/data-store.ts` | 静态 import 历史快照（event-metrics + 3 币 K 线 + funding），`getSnapshotCandles/Funding/EventCandles`；ETHFI 无快照返回空 | **复用模式**：只读对照基线；新 research store 与其物理隔离，禁回写快照 |
| `src/lib/market-client.ts` | OKX candles/ticker、Binance/OKX funding 双链路、`fetchWithFallback` 双域名、`FetchDiag`、TTL+inflight、ASSETS 唯一 symbol 源 | **高度复用**：新 OI/trades/books/mark 接口照此模式新增函数，复用诊断/缓存/错误分类；symbol 必须走 `ASSETS`；OI/价格归一必须再包一层 venue adapter + instrument registry（禁在 market-client 内硬编码 multiplier） |
| `src/lib/market-service.ts` | `getMarketOverview/buildMarketOverview` 纯组装可单测；分标隔离（BTC 共享依赖，他标独立降级）；`freshness/freshnessByCoin/candle/fundingTs` | **复用门控思想、禁直连**：新字段不接入 `buildMarketOverview`；分标隔离与诊断口径照抄到 research 采集 |
| `src/lib/freshness.ts` | Phase A 期望收盘 Bar 口径（K 线）+ 8h 年龄口径（现价）+ funding 相对 K 线口径；`CANDLE_FRESHNESS_GRACE_MS=15m` | **复用判定函数、新增分字段实例**：OI/trades/depth 各自独立调用 `assessFeedFreshness`，禁复用 K 线结果冒充；判定结果映射到 `reliability`（§6-2），跨所价差不进此函数 |
| `src/lib/v2/`（engine/samples/backtest/protocol） | Rolling42 同 detector；`scanBreakoutSamples/labelBreakoutOutcomes/findNormalWindows`；campaign walk-forward + FROZEN 协议 | **复用样本与验证框架**：四类窗口沿用 samples 口径 + 本协议 §4 冻结基线；`buildNormalWindows`（48H/stride48H）直接复用；新特征验证必须走 point-in-time + campaign walk-forward + holdout |

---

## §9 章节确认表（worker 自检）

| 任务要求 | 落点 |
|---|---|
| 范围：PEPE/DOGE/ETHFI+BTC，OKX 主+Binance 交叉，Bybit/CoinGlass 出范围且禁写常量；instrument registry 强制 | §0（无任何 Bybit/CoinGlass 常量/端点） |
| 最小五字段包（首轮 OI/taker-CVD/现货永续/mark-index-funding-basis/可靠性+跨市场健康；突破位距离复用现有；OrderBook/强平 P1）+ 全量字段清单（价格三层/venue-aware OI/正交双状态） | §1、§2（与 README 口径统一） |
| 采集设计：server-side research store，Schema 溯源/版本字段 + 冻结去重语义 + WS/REST 幂等，实时 Action 禁消费 | §3 |
| 窗口与样本：1m/5m/15m/1h/4h，四类窗口；旧 217/75/142 作废，冻结 290 raw / 116 episodes / 41-75 / 768 normal | §4 |
| 增量研究问题与验收指标（SLO 口径按 §10 终裁；分析单位 Independent Episode；禁分级术语） | §5 |
| 可靠性 8 条（正交双状态/50bps+2周期/冻结去重语义 instrument_registry_key + 双 funding freshness） | §6 |
| Gate：SOL APPROVE=Gate通过可进P0建设（含 SOL 确认项清单），本任务只出文档，无TBD | §7 |
| 二轮 HIGH-1 instrument identity（market_type/key/version；现货永续同串可区分） | §0.2、§2 通则-5、§3.2 |
| 二轮 HIGH-2 Eligible Dataset（universe 声明 + eligible 实评 + 三禁 + §5.1 全集口径） | §4.4、§5.1 |
| 二轮 HIGH-3 预警事件生命周期（5 态 + LEAD 起点 + FALSE 定义；禁权重评分） | §5.4、§10-2 |
| 二轮 HIGH-4 FIELD_FRESHNESS_POLICY（集中表 + Transport/Event 双判定 + 2 周期=cadence） | §6-0 |
| 二轮 MEDIUM-2 source_event_id 无原生 ID 保持 null（去重可用源 ts，禁冒充原生） | §3.2、§6-7 |
| 三轮 HIGH-1 禁未来Episode去重（prealert_id独立+cycle/structure/level/target_close四字段+预确认去重键 `symbol_norm + structure_id + breakout_level_id + target_confirmation_close_ts` +linked只许确认后回填，R1） | §5.4 |
| 三轮 HIGH-2 去重键全改instrument_registry_key（symbol_norm只分析不用作唯一身份） | §6-7、§3.2 |
| 三轮 HIGH-3 删分级统计术语（LEAD/Capture/Warning→Confirm冻结定义，分级另开协议） | §5.2、§5.4、§10-1~2 |
| 三轮 HIGH-4 P0.0 SOURCE CHARACTERIZATION（非评测probe≥24h+基线文件六项冻结，冻结前禁forward评测且probe禁入评测；REV4：probe为APPROVE后P0第一步、非前置门、授权单向） | §6-P0.0、§6-0、§7 |
| 三轮 HIGH-5 funding current/history双freshness（current按采集cadence，history按settlement，未到结算禁当HEALTHY） | §6-0 |
| 三轮 HIGH-6 授权链统一（SOL APPROVE=Gate通过可进P0，无TBD；§10七项FROZEN DECISIONS） | §7、§10 |
| 三轮 HIGH-7 Expiry冻结（下一收盘边界+15min grace，未确认且未INVALIDATED则EXPIRED计FALSE） | §5.4、§10-7 |
| 三轮 MEDIUM-2 funding_cross_diff_pp=(okx_raw-binance_raw)×100缺失null | §2 P0-E |
| 只读调研 data-store/market-client/service/v2 复用度并写入 | §8 |
| 禁阈值权重改动/禁手机端/禁胜率包装 | §0.3、§5.2、§7（src 零改动） |

---

## §10 SOL FROZEN DECISIONS（七项落字版，三轮 HIGH-6/HIGH-7；无TBD、无待拍板）

> 授权：SOL APPROVE = Gate 通过、可进 P0 建设。本节七项为冻结决定值，实现侧按此执行，禁自选、禁 TBD。

1. `SLO_LEAD_MIN`（LEAD 终裁）：`LEAD = confirmed_ts - warning_active_ts`；有效预警按 **median ≥ 30min** 判定，且**强制并列报告 P25 / 信号比（signals-per-month）/ 捕获率（Capture = 4H_CONFIRMED 中曾 ACTIVE 占比）**，禁只报中位数；禁 L2/L3 口径。
2. `SLO_FALSE_PER_DAY`（FALSE 终裁）：按 **≤ 1 / 币 / 天、7 天滚动** 统计，并报告 **daily p95**。FALSE 事件单位 = 按 §5.4 进入 `EARLY_WARNING_ACTIVE` 后未转确认而进 `INVALIDATED` / `EXPIRED` 者；Warning→Confirm（ACTIVE 转确认占比）强制并列报告。
3. `SLO_DELIVERY_P95`（DELIVERY 终裁）：以 **`source_event_time → alert_received_time`** 全链路统计（服务端检测延迟、推送成功率、重复率、漏发率），**P95 ≤ 120s**。
4. `SLO_UPTIME`（UPTIME 终裁）：**≥ 99.5%，按 exchange×field 独立统计**（`uptime_{exchange,field}`，分母为该字段期望采集周期数，禁跨字段混算）；**50bps 跨所价差禁直接降级 reliability**（只走 `cross_market` 候选→连续 2 周期确认路径，见 §6-3）。
5. ETHFI：**前向采集**（与 PEPE/DOGE 同框架接入），历史基线缺失字段记 `unknown/missing`；首轮仅采集不纳入增量评测。
6. OI 口径（终裁）：通用 `oi_raw × mark × multiplier` 公式**否决**；按 §2 通则 **venue-aware** 执行（OKX 优先官方 `oiUsd` 并保留 `oi/oiCcy/metadata`；Binance 原生 `openInterest` 由其 adapter 转 `oi_notional_usd`；`1000PEPE/PEPE` 走 instrument registry canonical 归一；禁硬编码 multiplier）。
7. Expiry（终裁，HIGH-7）：`target_confirmation_close_ts = warning 所在形成中 4H 的下一收盘边界`；至 `target_confirmation_close_ts + CANDLE_FRESHNESS_GRACE_MS（15min）` 未确认且未 `INVALIDATED` 则 `EXPIRED` 并计 FALSE；禁 Builder 自选固定 expiry。
