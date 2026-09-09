# ETHFI 接入 + 分标隔离返修｜Product Review（只读验收，禁改源码）

- 任务：task_192eb87813b5｜基线：HEAD `1bdda79`（ETHFI 接入前存档点）+ workdir 未提交改动（31 改 + `src/lib/ethfi.test.ts`、`src/lib/market-service-isolation.test.ts` 新增）
- 上游输入：复审 ENDORSE_PARTIAL、QA PASS（报告文件未在本机落盘，结论以任务书为准；本报告只记自己实测到的事实）
- 验证手段（均只读）：源码 diff 走查 + `pnpm test` + `pnpm ts-check` + 本地 dev server（:5000）live 实测 + 桌面 Chrome headless 真机截图（同机桌面端）
- 时间：2026-09-09 ~09:25–09:40（UTC+8）；交易所 live 可达

## 逐项结论

### 1) ETHFI 资产页：正确显示、精度、关键价非零非错量级 → PASS
- live 实测（`/api/market/overview`，status=live）：`ethfi.state=RETESTING（回踩确认）`，现价 0.6024–0.6037（OKX 永续 `ETHFI-USDT-SWAP`），`keyLevels={resistance:0.6235, breakoutLevel:0.5913, invalidation:0.58609, ema20:0.5851}`——全非零、量级正确（0.58–0.62 区间自洽：失效位 < 突破位 < 现价 < 压力位）。
- 精度：`formatPrice` 同函数自适应（0.58 量级→4 位小数，无科学计数；ETHFI-MARKET2 单测锁定）。真机 `/asset/ethfi` 显示 `0.6028 / 0.5913 / 0.5861 / 0.6235`，K 线图为真实 ETHFI 行情（非空/非占位）。
- `/api/market/candles?coin=ETHFI` live（`ETHFI-USDT-SWAP`），`/api/market/funding?coin=ETHFI` live（`ETHFIUSDT`，binance 首选命中），episode `EP-ETHFI-003`（160h，isEpisodeStart），env ALLOW。
- `/asset/ethfi` 200，`/asset/btc` 仍 404（品类约束未破）。

### 2) Freshness 三态与不可用进 BLOCKED → PASS
- 四币全 live 时全局 `freshness=ok`，`freshnessByCoin` 三标全 ok（live 实测）。
- 单测锁定：ETHFI-FRESH1~6（STALE 传播 / null→unavailable / 旧三币调用判定不变 / grace 同标准）+ ISOL-A1~A5。
- 真机 incidentally 复现 UNAVAILABLE 全链路（09:33 出站超时风暴，全币种 timeout）：页面正确降级为 `K线ETHFI·UNAVAILABLE·最近收盘未知` + `现价ETHFI·unavailable` + DiagBox 逐币种诚实诊断（`OKX ETHFI K 线失败：timeout…`），无快照冒充。分标语义：全局 status/freshness 只看 BTC+PEPE+DOGE（ETHFI 故障不拖垮全局，ISOL-A2 代码+单测有据）。
- 观察项（LOW，不 blocking）：`health` 的 `okxOk` 仍为四币全与（含 ETHFI），ETHFI 单点失败会使 health 摘要 `okx:'failed'`，而 overview 保持 live——仅诊断口径差异，建议后续统一口径或注释说明。

### 3) 三标同变报警行为（禁叠音失控）→ CONDITIONAL（LOW 观察项，不打回）
- ETHFI 纳入报警轮询/订阅/设置/去重/ACK 全链路（AlertCoin 含 ETHFI，默认订阅同 DOGE，settings `coins` 走 `DEFAULT_COIN_SWITCHES` 唯一来源，旧持久化经 sanitize 补 `ETHFI=true`；单测 ETHFI-ALERT1~6）。
- 真机首载三币同变（PEPE REJECT + DOGE/ETHFI RETEST_WATCH）同时建 3 横幅 + 1 Modal：队列 append 不覆盖、有序堆叠，未失控。
- 声音（代码级，headless 无法人耳验证）：三报警同 tick 各调一次 `scheduleAlertSound`，`playAlertSound` 不做互斥/排队——同种短音（≤0.6s）会短促叠加。三重保险在位：音量钳制（gain 0.5×上限）+ 有限 Pattern/循环上限（maxSoundLoops）+ Mute/暂停声音/Esc/ACK 即停（per-key 取消）。结论：叠音存在但有界可控，不构成“失控”；若产品要求严格串行，需另起需求（不在本轮验收内）。

### 4) 刷新无首载误报 → PASS（含一条 by-design 行为说明）
- 机制：seenKeys/acked/history/active 持久化 localStorage；首轮 `prev=null` 建报警后，同 key 刷新命中 `duplicate-key/acked` 不再重建（B-TEST5/B-TEST25 + ETHFI-ALERT4 同标准）。
- 真机同 profile 两次加载：`历史（3)` 未增长、无重复横幅、无 Modal 重弹 → 无误报/无重复。
- By-design 说明：全新 profile 首次加载会对当前已订阅状态建报警（如本次三横幅）——这是真实状态发现，非虚假数据；与 PEPE/DOGE 既有行为一致，ETHFI 未引入新语义。

### 5) ETHFI 报警/ACK/History 与双币隔离 → PASS
- alertKey `ETHFI|EP-ETHFI-001|BREAKOUT_TRACK`（symbol+episodeId+action，与双币同格式）；状态变化才建；同 key 去重；ACK 按 key 隔离（新 Episode 键不同可再报）；TEST 预览（`test-episode`）禁写真实历史（代码 + ETHFI-ALERT4 + 真机 `历史（3)` 未被测试污染）。
- 设置页分币种开关已含 ETHFI（三币同列）；`sanitizeSettings` 兼容旧两币持久化。
- 报警正文价格走 `formatPrice`（R1 已修）：真机横幅 `当前价格 0.6028 / 本轮突破位 0.5913 / 结构失效位 0.5861`，无浮点伪影。

### 6) QA 转交 2 处显示口径差异目检定级 → 两处均为 LOW，放行
- QA 转交原文未在本机落盘（业务仓 `docs/qa` 仅有旧 BUGS/CHECKLIST + 本次截图目录；workspace 无 ETHFI QA 交接文件）。以下为本轮独立目检到的显示口径差异，按 LOW 定级（均非 ETHFI 引入的新缺陷，不打回）：
- D1（LOW）：API 原始值 vs UI 格式化。`pepe.invalidation=3.6462599999999995e-06`、`doge.invalidation=0.08957259999999999`（API 原样透出），UI 经 `formatPrice` 显示为 `3.6463e-6 / 0.0896` 正确。ETHFI 本轮三个关键价恰为干净小数，无伪影。现状可接受（已知口径差，见 CURRENT_STAGE §9.4）；若要根治需 API 层统一格式化，另起小改。
- D2（LOW）：`/api/similarity/current?coin=ETHFI` 返回 `coin 必须为 PEPE 或 DOGE`——排除本身正确（ETHFI 无基线，VALID_COINS=BASELINE_COINS），但错误文案未说明基线原因，直接调 URL 的用户会困惑。建议改文案为“仅支持有历史基线的标的（PEPE/DOGE）”，另起文案小改。
- 附带 LOW：`/asset/ethfi` 历史区显示“该币种历史典型形态（0）”空网格、无一行空缺说明（首页与方法论有完整空缺标注）。建议补一句“暂无历史基线”，文案小改。
- 三处皆不影响判定/数据正确性 → LOW 放行。

### 7) 研究空缺标注无胜率误导 → PASS
- 方法论页 SSR 实测：`ETHFI 研究指标（Precision/Recall/胜率类）暂为空缺：21 个历史事件无 ETHFI 基线样本…禁编造` 在位；全页 15 处“胜率”均为否定式合规表述（不输出胜率/不包装成胜率/不构成收益承诺）。
- 首页：`ETHFI 暂无历史基线样本（实时信号与历史对照仅覆盖 PEPE/DOGE）` + `ETHFI 样本 0（暂无历史基线）` StatCard；历史页：`21 个…（PEPE 11 个，DOGE 10 个）` + 仅 PEPE/DOGE 筛选签（无 ETHFI 假入口）；相似性页：仅 PEPE/DOGE 当前像谁面板（ETHFI 无面板）；`/api/similarity/current?coin=ETHFI` 诚实拒绝。
- 阈值/权重零改动：ETHFI-QUANT1/2 + `pnpm test` 158/158（132 旧 + 19 ETHFI + 7 隔离）全绿，`ts-check` 0 错误。

### 8) 五页回归无视觉破坏 → PASS
- 真机截图（1440 桌面，hydrated）：`01-home`（三卡并列：PEPE 当前淘汰 / DOGE 回踩重点观察 / ETHFI 回踩重点观察，零溢出）→ PASS；`02-asset-ethfi`（价格/关键价/三行新鲜度/K 线图/资金费率/信号依据全渲染）→ PASS；`03-history`（21 样本网格完整）→ PASS；`04-similarity`（双当前面板 + PCA 散点）→ PASS；`05-methodology`（边界/行动/十态/分层全节）→ PASS。
- `06-refresh-a/b`：刷新无重复报警 + UNAVAILABLE 诚实降级（见 §2/§4）。
- PEPE/DOGE 卡片与旧版同渲染路径，数值随 live 行情正常漂移（PEPE FAILED_BREAKOUT / DOGE RETESTING，与上一版 REJECT 快照的字面差异来自输入变化，非回归）。

## 截图（均在业务仓 `docs/qa/ethfi-acceptance/`，留档待提交）
- `01-home.png`（三币三卡 + 三横幅首载状态）
- `02-asset-ethfi.png`（ETHFI 详情全页）
- `03-history.png`（21 样本库）
- `04-similarity.png`（相似性）
- `05-methodology.png`（方法论）
- `06-refresh-a.png / 06-refresh-b.png`（同 profile 刷新对照：无重复报警；b 兼 UNAVAILABLE 降级证据）

## 总体结论：CONDITIONAL_ACCEPT（条件性放行提交，不放行自动部署）
- 放行提交：8 项中 6 PASS + 2 条件项（§3 叠音有界可控 Shan 观察项；§6 三处 LOW 文案）。量化零改动，测试 158/158 + ts-check 干净，真机 hydrated 全链路正常。
- 条件：① 本报告截图目录随提交入仓；② 三处 LOW 文案（D1 API 格式化根治 / D2 similarity 错误文案 / 附带 asset-ethfi 空缺一行说明）+ §3 声音串行化（如产品坚持）全部另起小改，不得在本提交顺手改源码；③ 提交后部署需走生产复验（精确 SHA、生产 ETHFI live、candle lag0、freshnessByCoin 在位）方可关闭。
- 是否放行提交部署：放行提交（commit+push）；部署需用户另行批准，部署后必须生产复验。
