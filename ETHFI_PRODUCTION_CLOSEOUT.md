# ETHFI 三标接入｜生产关闭报告（PRODUCTION CLOSEOUT）

- 生产 URL：`https://pepe-doge-breakout-radar.vercel.app`
- 验证时间：2026-09-09 ~10:25–10:32（UTC+8；生产 `serverTimeUtc` ≈ 2026-09-09T02:29–02:30Z）
- 验证人：QA+Builder worker（task_f3ddbbca71cf，只读生产复验；禁改线上配置，禁手机端新工作）
- 上游：Product Review `docs/qa/ethfi-acceptance/PRODUCT_REVIEW_ETHFI.md`（CONDITIONAL_ACCEPT，本地 live 已验）

---

## 1. 业务仓版本基线（根 = 业务仓 `pepe-doge-breakout-radar-deepseek-v4-pro/`）

| 项 | 值 |
|---|---|
| 分支 | `main` |
| 起始 HEAD（ETHFI 接入前存档点） | `1bdda79` chore(radar): 存档点 ETHFI接入前，Ending bf2329f后状态 |
| 结束 HEAD（本次验证对象） | `39a63f3` feat(radar): ETHFI三标接入+分标隔离+UX返修（量化阈值权重零改动） |
| Commit（HEAD 内 46 files, +1497/−411） | 见 `git show --stat HEAD` |
| workdir status | dirty：仅 `M next-env.d.ts`（Next build 自动生成，非业务源码；业务源码 clean） |
| origin 同步 | `origin/main` up-to-date（`git rev-list --left-right HEAD...origin/main` = 0/0） |
| 生产内容在位确认 | 生产行为与 `39a63f3` 一致（ETHFI 三标 live、freshnessByCoin 三标、EP-ETHFI-003） |

---

## 2. 生产部署标识

| 项 | 值 |
|---|---|
| 生产 URL | `https://pepe-doge-breakout-radar.vercel.app` |
| 部署时间（精确） | UNVERIFIED（无 Vercel API 凭据查 Deployment；行为级在位见 §7） |
| 部署 SHA（精确） | **UNVERIFIED**（同上；生产 payload 行为与 HEAD `39a63f3` 一致：ETHFI live + 三标 freshnessByCoin + keyLevels 非零正确量级） |
| 地域/运行时（health 自述） | `vercel:production / hnd1 / node v24.19.0` |

---

## 3. ETHFI 改动逐项（HEAD `39a63f3` vs `1bdda79`，源码证据）

| # | 改动 | 证据 |
|---|---|---|
| E1 | `ASSETS.ETHFI` 注册（OKX `ETHFI-USDT-SWAP` / Binance `ETHFIUSDT`，sortOrder 30，`hasHistoryBaseline:false`） | `src/lib/config.ts:204-217` |
| E2 | `TRADE_COINS=[PEPE,DOGE,ETHFI]`，`MARKET_COINS` 含 BTC+ETHFI，`BASELINE_COINS` 派生排除 ETHFI | `src/lib/config.ts:235-243` |
| E3 | `SNAPSHOT_KEYS.ETHFI={candles:null,funding:null}`（无基线快照，调用方按缺数据处理） | `src/lib/config.ts:253-258` |
| E4 | 精度自适应：`formatPrice` 同函数（0.58 量级→4 位小数）；新增 `formatPricePlain`（UI 全小数，禁科学计数，API 原样不动） | `src/lib/format.ts:30-56` |
| E5 | 新鲜度四币合并：ETHFI 键存在即纳入（STALE/UNAVAILABLE 传播），键缺席旧三币判定不变；grace 15min 同标准 | `src/lib/freshness.ts:183-222,324-377` + 单币隔离 `deriveCoinFreshness` |
| E6 | 报警纳入：`AlertCoin` 含 ETHFI；默认订阅/开关同 DOGE；`sanitizeSettings` 补旧两币持久化 `ETHFI=true` | `src/lib/alert-center.ts:48,391-422` |
| E7 | TEST 隔离：`TEST_ALERT_EPISODE_ID='test-episode'`，`pushHistory` 拒收测试记录 | `src/lib/alert-center.ts:320-372` |
| E8 | 引擎同框架：ETHFI 走 `analyzeAssetV2` 同阈值同权重，episode 前缀 `EP-ETHFI-` | `src/lib/v2/engine.ts`，`src/lib/ethfi.test.ts:ETHFI-ENGINE1` |
| E9 | 研究隔离：history/similarity 仅 PEPE/DOGE；`/api/similarity/current?coin=ETHFI` 诚实 400 拒绝 | 生产实测 §8；`VALID_COINS=BASELINE_COINS` |
| E10 | 页面：首页三卡+ETHFI 样本 0 空缺卡；`/asset/ethfi` 详情；方法论/历史/相似性空缺标注 | `src/app/page.tsx` diff，生产 §7 |
| E11 | health 诊断四币全探（OKX/Binance instruments 含 ETHFI 双 symbol） | 生产 `health.json` config 段 |

---

## 4. UX 走查 15 项返修（HIGH-1~4 / MED-5~9 / LOW-10~15）

| 编号 | 内容 | 生产/代码在位 |
|---|---|---|
| HIGH-1 | 排队合并：多 ACTIVE 队列视图禁覆盖禁只放首个；Modal 按队列逐个处理（1/N+切币种tab+倒计时）；横幅上限外折叠聚合 | 代码 `AlertCenter.tsx:114,469-519`；Product Review 真机三横幅+1 Modal 堆叠有序 |
| HIGH-2 | 严重度区分：CRITICAL/IMPORTANT/WATCH/INFO 四色边框+标题+badge 互异 | `ALERT_SEVERITY_STYLES`；单测 UX-HIGH2-1/2 |
| HIGH-3 | 新鲜度收敛：badge 行一行摘要 `summarizeSourceFreshness` + title 全明细；桌面留三行 | `freshness.ts:230-240`，`DataStatus.tsx:134`；单测 UX-HIGH3-1/2 |
| HIGH-4 | 报警卡片脉冲只作用边框（禁整卡 animate-pulse，避与 Modal dim 双重刺激） | `globals.css:187` |
| MED-5 | 小币种禁科学计数法：`formatPricePlain` UI 全小数；API 层原样透出不动；报警正文同口径 | 单测 UX-MED5-1~4；生产 PEPE 全小数见 §7 |
| MED-6 | 失效后历史评分灰化收进折叠降权，仅复盘 | `AssetDetail.tsx:234`，`SignalCard.tsx:115` |
| MED-7 | 声音试听即保存（无两段式试听/保存心智负担） | `AlertCenter.tsx:601` |
| MED-8 | 常驻入口移左下避横幅碰撞；铃铛数只计 ACTIVE（禁误读历史数） | `AlertCenter.tsx:554` |
| MED-9 | 绝对时间收 title tooltip（正文只留相对口径）；第二行拆段 | `DataStatus.tsx:90` |
| LOW-10~12/14 | 纯展示层微调（ts-check + lint:build + build 覆盖，无策略语义） | 代码在位，构建覆盖 |
| LOW-13 | K 线 Y 轴全小数标签加宽 56→96（与 MED-5 同解，防截断） | `CandleChart.tsx:25` |
| LOW-15 | 首载骨架占位（min-h 防 CLS，三卡同高） | `LiveRadar.tsx:170` |
| 弹窗/卡片二选一 | Modal（队列逐个，需确认）+ 横幅（折叠聚合）+ 系统通知/标签闪烁/卡片脉冲通道可配，默认 modal+banner+tabflash+cardpulse 开、system 关 | `DEFAULT_ALERT_SETTINGS.channels`，生产页面含 AlertCenter（SSR 标记在位） |

---

## 5. 双源实测表（本地自动测试 × 生产 HTTP 实测）

| 维度 | 本地源（`pnpm test`，本机 2026-09-09） | 生产源（本报告 §7–§9 实测） | 一致 |
|---|---|---|---|
| 测试总数 | **166/166 pass**（旧 132 + ETHFI 19 + 隔离 7 + 其余；Review 时 158，本次 +8） | —（生产不跑单测） | — |
| 三标状态 | fixture 合成可跑（ETHFI-ENGINE1） | PEPE FAILED_BREAKOUT / DOGE RETESTING / ETHFI RETESTING | 语义一致 |
| 新鲜度三态 | ETHFI-FRESH1~6 + ISOL-A1~A5 全绿 | freshness ok + byCoin 三标 ok + lag 全 0 + LIVE | 一致 |
| 报警/TEST 隔离 | ETHFI-ALERT1~6（含 TEST 拒写历史）全绿 | 代码在位；真报警未伪造（只观察） | 一致 |
| 精度/关键价 | ETHFI-MARKET2、UX-MED5-1~4 全绿 | 0.58–0.62 量级 4 位小数；PEPE 全小数 | 一致 |
| 研究隔离 | ETHFI-RESEARCH1（快照空）全绿 | similarity 400 拒绝 + 方法论空缺文案 3 处 | 一致 |
| Quant 零改动 | ETHFI-QUANT1/2 全绿 | 生产阈值行为未漂移（episode/评分结构正常） | 一致 |

---

## 6. 配置化清单（唯一来源，禁散落字面量）

- `ASSETS`（标的注册表：instId/spot/funding/sortOrder/enabled/hasHistoryBaseline/theme）→ `config.ts:174-232`
- `TRADE_COINS / MARKET_COINS / BASELINE_COINS / DEFAULT_COIN_SWITCHES` → `config.ts:235-250`
- `SNAPSHOT_KEYS`（研究快照映射）→ `config.ts:253-258`
- `DEFAULT_V2_THRESHOLDS / DEFAULT_V2_WEIGHTS`（阈值/权重冻结值）→ `config.ts:50-124`
- `STATE_META`（十态展示映射）→ `config.ts:137-148`
- `DEFAULT_SUBSCRIPTIONS / DEFAULT_ALERT_SETTINGS / ALERT_STORE_KEYS / CAPABILITY_NOTE` → `alert-center.ts:39-46,391-432,438-440`
- `CANDLE_FRESHNESS_GRACE_MS=15min / CANDLE_STALE_AFTER_MS=8h / FUNDING_STALE_AFTER_MS=24h` → `freshness.ts:36-69`
- `OKX_PERP_LINE`（来源行文案唯一来源）→ `config.ts:261-268`

---

## 7. Quant 审计：NONE（策略零改动）

- 阈值冻结值生产行为一致：`breakoutLookbackCandles=42 / VolStrong=2.0 / VolWeak=1.2 / VolPctStrong=90 / fundingOverheat=0.03 / btcMaxDrawdown=-10`（单测 ETHFI-QUANT1 锁定）。
- 权重各层合计 100（Setup/Trigger/FollowThrough；单测 ETHFI-QUANT2 锁定）。
- 本轮无 M5/holdout/回测参数变更；新鲜度/报警/展示层改动均声明非交易阈值（`freshness.ts:12-16`，`alert-center.ts:8-15`）。
- 结论：**Quant 影响 NONE**，无需重跑 walk-forward。

---

## 8. 三态 + 分标隔离验证（生产）

- 全局：`freshness.status=ok`，`candle.freshnessStatus=LIVE`，`candleLagBars={PEPE:0,DOGE:0,BTC:0,ETHFI:0}`，`staleReason=null`。
- 分标：`freshnessByCoin` PEPE/DOGE/ETHFI 全 `ok`（`lastUpdatedTs=1788912000000` 三标一致）。
- 资金费率：`fundingTs` 三标一致（`1788912000005`），`fundingProvider=binance`。
- 分标隔离：`deriveCoinFreshness` 单标故障只降级自身（代码 + ISOL 单测）；生产本次三标全 LIVE，STALE/UNAVAILABLE 分支为代码级有据、生产本次未触发（诚实声明，非假装触发）。
- Review 观察项（LOW，不 blocking）：`health.summary.okx` 为四币全与口径（含 ETHFI），与 overview（ETHFI 故障不拖垮全局）存在诊断口径差异，后续统一或注释说明。

---

## 9. 三标 Live Case（本次生产 payload，`docs/qa/ethfi-production/overview-ethfi.json`）

抓取：`generatedAt=1788920975482`；现价 `PEPE 3.634e-06 / DOGE 0.08994 / ETHFI 0.6004 / BTC 78767.8`；env gate=ALLOW（BTC 上行，7d +1.47%，24h 回撤 −2.37%）。

| 币种 | state | 关键价（API 原始；展示按 formatPrice 口径） | 突破/Episode | 备注 |
|---|---|---|---|---|
| PEPE | FAILED_BREAKOUT（突破失败） | 现价 0.000003634（UI 全小数，禁科学计数）；resistance 3.879e-06 / breakoutLevel 4.097e-06 / invalidation 3.6462599999999995e-06（浮点伪影已注明，UI 显示 0.0000036463…全小数）/ ema20 3.6111884848729072e-06 | EP-PEPE-001，108 bars / 432h，确认突破 | 与上一版字面差异来自 live 行情漂移，非回归 |
| DOGE | RETESTING（回踩确认） | 现价 0.08994；resistance 0.09529 / breakoutLevel 0.08995 / invalidation 0.08957259999999999（伪影注明，UI 0.0896）/ ema20 0.0892653830402779 | EP-DOGE-002，19 bars / 76h，isEpisodeStart | 连续性正常 |
| ETHFI | RETESTING（回踩确认） | 现价 0.6004；resistance 0.6235 / breakoutLevel 0.5913 / invalidation 0.58609 / ema20 0.5851454480909144（干净小数，无伪影；失效位<突破位<现价<压力位自洽） | EP-ETHFI-003，40 bars / 160h，isEpisodeStart；trigger 六条件全 met；现价站上突破位、回踩守住 | 无 Precision/Recall/胜率基线：一律未知/缺失（见 §11） |

模板字段（LIVE_CASE_EVIDENCE_TEMPLATE §2 五件套）映射：①当前行动=`state/stateLabel`；②关键价格=`keyLevels`+现价+`breakout.distancePct/episodeAgeHours`；③为什么=Setup/Trigger/Follow-through conditions 全文（payload 内）；④接下来观察=`followThroughConditions`+episode 状态（payload 内）；⑤新鲜度=`dataQuality`（三标均为"关键数据完整"）+ §8。

---

## 10. 生产验证逐项（HTTP 状态 + 语义）

| # | 检查 | 结果 |
|---|---|---|
| P1 | `GET /` | 200（72473 B，含 AlertCenter/ETHFI 标记） |
| P2 | `GET /asset/pepe` | 200（客户端渲染；数据经 API，语义见 P5） |
| P3 | `GET /asset/doge` | 200 |
| P4 | `GET /asset/ethfi` | 200（K 线/关键价经 API；Review 真机已验显示 0.6028/0.5913/0.5861/0.6235 全小数） |
| P5 | `GET /api/market/overview?coin={pepe,doge,ethfi}` | 三标全 200 `ok/live`；三标信号同体返回（query coin 不改变 payload 形状，行为与既有实现一致） |
| P6 | `GET /api/market/candles?coin={pepe,doge,ethfi}` | 三标全 200 `ok`；各 200 根（199 confirmed + 1 intraday）；instId `PEPE/DOGE/ETHFI-USDT-SWAP`；`lastConfirmedTs=1788897600000` 四币对齐 |
| P7 | `GET /api/market/funding?coin={pepe,doge,ethfi}` | 三标全 200 `ok`；symbol `1000PEPEUSDT/DOGEUSDT/ETHFIUSDT`；末点 `1788912000005` 三标一致 |
| P8 | `GET /api/market/health?coin={pepe,doge,ethfi}` | 三标全 200 `ok`；`summary={okx:ok,binance:ok,funding:ok}`；config instruments/binanceSymbols 含 ETHFI |
| P9 | 显示精度关键价 | ETHFI 0.58–0.62 量级 4 位小数无科学计数；PEPE 全小数（MED-5）；API 浮点伪影（PEPE/DOGE invalidation）已注明不直贴 |

---

## 11. 专项 9 项摘要

| 专项 | 结论 |
|---|---|
| S1 三标页面（含 ETHFI 精度关键价） | PASS（P2–P4 + Review 真机；§9 自洽） |
| S2 三标 candles API | PASS（200 根/对齐/instId 正确） |
| S3 三标 funding API | PASS（symbol/末点一致，binance 优先） |
| S4 三标 health API | PASS（双源 ok；LOW 口径观察项见 §8） |
| S5 freshness 三标 ok + lag 全 0 | PASS（§8） |
| S6 UX 返修生产验证（排队合并/严重度/新鲜度收敛/弹窗卡片） | PASS（代码在位 + Review 真机；headless/SSR 标记在位；手机端未验且禁新工作，见 §14） |
| S7 TEST ALERT 全链路（标 TEST，真报警只观察不伪造） | PASS_CANDIDATE（代码隔离在位：TEST 键/标题/episode 三命中拒写历史；设置页"发送测试报警"按钮+隔离文案在位；本次服务端复验未点击生产 TEST 按钮、未伪造真报警；真机隔离行为 Review 已验历史未被污染） |
| S8 研究隔离（ETHFI 空缺在位、无胜率） | PASS（similarity 400 拒绝；方法论"暂为空缺/禁编造/不构成收益承诺"在位；首页 ETHFI 样本 0 卡） |
| S9 PEPE/DOGE 生产信号连续性 | PASS（EP-PEPE-001/EP-DOGE-002 连续；hardVeto 全 NONE；dataQuality 全完整） |

---

## 12. 自动测试数字

- `pnpm test`：**166 tests / 166 pass / 0 fail**（`node --import tsx --test src/lib/*.test.ts src/lib/v2/*.test.ts`，~353ms）。
- 构成：ETHFI 专项 19（FRESH 6 + ALERT 6 + MARKET 3 + ENGINE/QUANT/RESEARCH 4）+ 隔离 7（market-service-isolation）+ UX 回归 8（ux-fix）+ 既有 132（含 action 15、B-TEST 报警系列、v2 10 项核心约束、21 事件回归）。
- `ts-check`：Review 时 0 错误；本报告周期未改源码，结论沿用。

---

## 13. 证据路径（仓内，禁临时目录）

- 本报告：`ETHFI_PRODUCTION_CLOSEOUT.md`（业务仓根）
- 生产 payload 存档：`docs/qa/ethfi-production/overview-ethfi.json`、`candles-{pepe,doge,ethfi}.json`、`funding-{pepe,doge,ethfi}.json`、`health.json`、`similarity-ethfi-400.json`
- 真机截图：`docs/qa/ethfi-acceptance/01-home.png`、`02-asset-ethfi.png`、`03-history.png`、`04-similarity.png`、`05-methodology.png`、`06-refresh-a.png`、`06-refresh-b.png`
- 上游验收：`docs/qa/ethfi-acceptance/PRODUCT_REVIEW_ETHFI.md`
- 模板：`LIVE_CASE_EVIDENCE_TEMPLATE.md`
- 无 `/tmp` 引用：本次复验的临时 HTML 已弃用，未入证据链。

---

## 14. 限制（诚实声明）

1. 精确 Deployment SHA/时间 UNVERIFIED（无 Vercel 凭据；行为级在位已确认）。
2. 线上配置零改动（本次只读 GET，无 POST/设置写入；不碰 Vercel/域名/环境变量）。
3. 手机端：本次及 Review 均为桌面端验证；**禁手机端新工作**（未验移动端，不断言移动端状态）。
4. TEST ALERT：本次未在生产点击"发送测试报警"（避免污染任何真实用户本地状态观察之外的副作用）；隔离结论来自代码+单测+Review 真机；真报警只观察（生产当前三标信号已记录于 §9，未伪造任何报警）。
5. workdir dirty 仅 `next-env.d.ts`（构建生成物），业务源码与 HEAD 一致。
6. Review 遗留 LOW（D1 API 浮点伪影根治 / D2 similarity 错误文案 / asset-ethfi 空网格一行说明 / health 口径注释）：另起小改，不在本报告顺手改。

---

## 15. 终态

**Final Status：PASS_CANDIDATE**

- 理由：三标生产 live 全链路在位（§10 P1–P9 全 PASS），ETHFI Live Case 全字段齐（§9），Quant NONE（§7），研究隔离与无胜率合规（§11-S8），测试 166/166（§12）；唯一缺口是精确 Deployment SHA/时间 UNVERIFIED（§14-1）与 S7 生产按钮未亲手点击（by-design 让步，隔离代码+单测+Review 真机三重有据），故为 PASS_CANDIDATE 而非 FULL PASS；无 BLOCKED 项。
