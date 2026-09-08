# LIVE_CASE_EVIDENCE_TEMPLATE（实盘案例证据模板）

> 性质：每次记录 live 案例必须按此模板逐项填写，缺项写"未知/缺失"并说明原因，不许留空假装有数。
> 铁律：**禁拿旧截图当现状**——截图只证明截图时刻，断言当前状态必须用本次抓取的 API payload；复验时以 live 为准对齐预期（DOGE 曾两次漂移：RETEST_WATCH fixture → FAILED_BREAKOUT → INVALIDATED+STRUCTURE_VETO，见评审报告）。
> 时间一律 UTC 存储、展示按 Asia/Shanghai（UTC+8）；价格用 `formatPrice` 口径（API 原始浮点伪影如 `0.08957259999999999` 必须注明，不直接贴 raw 当展示值）。

---

## 0. 元信息

| 项 | 值 |
|---|---|
| 记录时间（UTC+8 / UTC） | |
| 记录人 | |
| 业务仓 HEAD | |
| workdir 状态（clean / dirty，dirty 需列文件） | |
| 生产 URL | `https://pepe-doge-breakout-radar.vercel.app` |
| 本记录对应部署内容（HEAD / workdir，未部署必须明写） | |

---

## 1. Input（输入证据：抓取时刻 frozen）

### 1.1 抓取时间

- `overview.generatedAt`（ms + UTC+8 可读）：
- 各 `prices.*.ts`（PEPE / DOGE / BTC）：
- 抓取命令（例：`curl -s <prod>/api/market/overview`）及本地存档路径：

### 1.2 价格（现价 + ts）

| 币种 | last | ts（UTC+8） | 与 generatedAt 差值 |
|---|---|---|---|
| PEPE | | | |
| DOGE | | | |
| BTC | | | |

### 1.3 Candle（K 线时间戳）

- `lastConfirmedTs`（PEPE / DOGE / BTC）：
- `lastCandleTs`：
- 4H 对齐检查（三币种同值？盘中 intraday 是否分离？）：

### 1.4 Funding（资金费率时间戳）

- `fundingTs.PEPE` / `fundingTs.DOGE`：
- `fundingProvider`（binance / okx / null）：
- funding 相对 K 线末根年龄（>24h 即 stale）：

### 1.5 Env（BTC 环境）

- `btc.price` / `return7dPct` / `maxDrawdown24hPct` / `closeAboveEma100`：
- `environment.gate`（ALLOW / CAUTION / BLOCK）：

### 1.6 Freshness（新鲜度三态）

- `freshness.status`（ok / stale / unavailable）+ `reason` + `lastUpdatedTs`：
- `SourceFreshnessRow` 8 路（K线×3 + 现价×3 + 资金费率×2）逐项：
- 生产 payload 有无 `freshness`/`fundingTs` 字段（无 = 生产仍为旧部署，铁证）：

---

## 2. Output 五件套（输出证据：按 ActionCard 结构）

> 五件套 = ①当前行动 ②关键价格 ③为什么 ④接下来观察 ⑤新鲜度/数据状态。逐币种（PEPE / DOGE）各填一份。

### 2.1 【PEPE】

- ① 当前行动：`code` / `emoji+title` / `severity` / `summary` 原文：
- ② 关键价格：`currentPrice` / `breakoutLevel`（本轮突破位）/ `invalidationLevel`（结构失效位）/ `nextResistance`（当前下一压力）/ `currentDistancePct`（当前距突破位）/ `breakoutExtensionPct`（突破当根超越幅度）/ `episodeAgeHours`：
- ③ 为什么：`reasons[]` 全文（✓/✗ 逐条）：
- ④ 接下来观察：`nextConditions[]` 全文（condition → outcome 逐条）+ `episodeStatus`：
- ⑤ 新鲜度/数据状态：`dataStatus` / `staleReason` / `最后有效更新` / `historicalOnly`（失效后历史评分是否灰化）：
- 附加：`state` / `env` / `episodeId` / Setup / Trigger / Follow / EntryHeat / Veto：

### 2.2 【DOGE】

（同 2.1 结构再填一份）

- ① 当前行动：
- ② 关键价格：
- ③ 为什么：
- ④ 接下来观察：
- ⑤ 新鲜度/数据状态：
- 附加：

---

## 3. 截图清单（只证当时，不证现状）

| 截图路径 | 对应时刻（UTC+8） | 对应 HEAD | 允许的断言 |
|---|---|---|---|
| | | | 仅"该时刻为 XXX" |
| | | | 仅"该时刻为 XXX" |

- [ ] 已确认：没有用任何旧截图断言当前状态；当前状态断言只引用 §1–§2 的本次 payload。

---

## 4. 判定

- [ ] CODE_COMPLETE（功能完整，代码+单测有据）
- [ ] LOCAL_VALIDATED（本地 test / ts-check / eslint / build 全绿）
- [ ] PRODUCTION_DEPLOYED（生产已含本 HEAD，精确 Deployment SHA 见 Vercel 控制台）
- [ ] PRODUCTION_DATA_VALIDATED（生产数据链路本次验证，stale/unavailable/degraded 未触发需注明"代码级有据、生产本次未触发"）

结论（仅三选一）：PASS_CANDIDATE / PARTIAL / BLOCKED ——理由：
