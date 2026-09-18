# BUGS（QA 缺陷台账）

> 范围：HEAD `505ef64` Action Card 当前行动卡（UX 决策解释层）。
> 验证环境：`pnpm test` 69/69、`tsc` 0 错误、`eslint --quiet` 0 告警；dev server `:5000` 真实运行（OKX live 可达，与沙箱无网预期不同，本轮按 live 路径验证）。
> 约束：QA 只写本文档与 `QA_CHECKLIST.md`，不改业务代码。`docs/roles/qa.md` 在本仓库不存在，特此标注。

## P2 / Low

### BUG-001 条件清单仍用旧文案 `rolling 阻力`，与新术语不一致
- 位置：`src/lib/v2/engine.ts:554`（`label: '4H 收盘突破 rolling 阻力'`）
- 复现：`GET /api/market/overview` → `pepe/doge.triggerConditions[].label` 含 `4H 收盘突破 rolling 阻力`（2026-09-08 实测双币种均命中）。
- 预期：本轮已将用户面统一为「本轮突破位 / 当前下一压力 / 结构失效位 / 突破当根超越幅度 / 当前距突破位」（`SignalCard`/`AssetDetail`/`ActionCard`），条件清单应同步改名或给出映射，否则同一页面出现两套阻力叫法。
- 实际：条件清单（`SignalCard.ConditionList`、`AssetDetail` 信号判断依据直接渲染 `c.label`）仍显示旧文案。
- 影响：纯文案一致性，不影响判定。

### BUG-002 方法论残留旧文案 `风险分`
- 位置：`src/app/methodology/page.tsx:152`（`全程由风险分与硬否决独立把关`）
- 预期：本轮已将 `Risk → Entry Heat · 追高/过热`（`SignalCard`/`AssetDetail`/`ACTION_CARD_REPORT §6`），方法论导语应同步为 Entry Heat。
- 实际：导语仍称「风险分」。

### BUG-003 Follow-through `WEAK≥35` 文档与实现不一致
- 位置：`src/lib/action.ts:159-184`（`describeFollowThrough`）vs `ACTION_CARD_REPORT.md §8`（`Follow-through HEALTHY≥60/WEAK≥35`）
- 复现：`describeFollowThrough('COMPUTED', 10, true, 10)` → `{grade:'WEAK'}`；`34/35/59` 亦全为 `WEAK`，代码中不存在 `35` 分支（仅 `>=60 → HEALTHY`，其余 `→ WEAK`）。
- 预期二选一：补 `35` 分支语义，或将文档修正为「`HEALTHY≥60`，其余为 `WEAK`（display-only）」。
- 影响：展示分档说明，不参与交易判定（源码已声明 display-only）。

## Info（建议，不判缺陷）

### INFO-001 `partial` 状态为死类型
- `LiveRadar`/`AssetDetail` 的 `OverviewResp.status` 含 `'live' | 'partial' | 'unavailable'`，但 `src/lib/market-service.ts:226` 只返回 `'live' | 'unavailable'`（`!okxOk || !canAnalyze ? 'unavailable' : 'live'`）。
- 建议：删除 `'partial'` 或实现真正的部分可用语义。当前无实际影响（`unavailable` 时 `pepe/doge` 为 `null` → `DATA_BLOCKED`，两端一致）。

### INFO-002 `price == invalidationLevel` 时少一条失效理由
- 位置：`src/lib/action.ts:274`（`currentPrice < invalidationLevel` 才追加「已低于结构失效位」）。
- `==` 时仍为 `REJECT`（正确），只是少一条理由。建议改为 `<=`（需产品确认等值语义）。

### INFO-003 `heldAbove=null` 按结构有效处理
- 位置：`src/lib/action.ts:297`（`heldAboveBreakoutLevel !== false` 即有效）。
- `breakoutConfirmed=true + heldAbove=null`（跟随数据缺失）→ `BREAKOUT_TRACK`。建议产品确认：未知是否应降级描述（当前 `PENDING` 文案已提示「尚无足够后续数据」，可接受）。

### STYLE-DEBT 硬编码 hex（历史遗留 + 本轮新增）
- `SignalCard.tsx:105,109,205`、`AssetDetail.tsx:207-209`：`#8AB4F8/#4FC3F7/#fb5e6e`（历史遗留）+ `#f5a623/#3ddc84`（本轮 `EntryHeatLine` 新增）。
- `AGENTS.md` 要求新增配色用 `--radar/--pepe/--doge/--btc/--bull/--bear/--warn` token。可映射：`#8AB4F8→--btc`、`#fb5e6e→--bear`、`#3ddc84→--bull`、`#f5a623→--warn`。功能无影响。

## 本轮验证通过（无缺陷）
- 优先级：`DATA_BLOCKED > REJECT > OVERHEATED > RETEST_WATCH > BREAKOUT_TRACK > WATCH > NO_ACTION` 全对（含 `BLOCK+高热→REJECT`、`RETEST+高热→OVERHEATED`、`FAILED/MARKET_BLOCKED→REJECT`、`无结构+高热→NO_ACTION/WATCH`）。
- Live 映射：`GET /api/market/overview`（live）`PEPE INVALIDATED+STRUCTURE_VETO+Setup100/Trigger100 → REJECT`；`DOGE RETESTING+无否决 → RETEST_WATCH`；与 `action.test.ts` TEST 11/12 一致；反向（DOGE 模拟跌破）→ `REJECT`；同输入确定性一致。
- 边界：EntryHeat `39→低/40→中/69→中/70→高`；`currentDistancePct 24.99→BREAKOUT_TRACK/25→OVERHEATED`（`chaseDistancePct=25`）；`stale/unavailable→DATA_BLOCKED` 且关键价位清空。
- 禁用语：live 双币种输出无「买入/开仓/胜率/建议」；全站「胜率/准确率/假突破概率」仅出现在「不输出…」声明中，无数值承诺。
- 改名：`Risk→Entry Heat`、`突破位→本轮突破位`、`rolling阻力→当前下一压力`、`失效观察位→结构失效位`、`突破距离→突破当根超越幅度` + 新增「当前距突破位」在 `SignalCard`/`AssetDetail`/`ActionCard` 生效；失效后历史评分灰化 + 「仅用于复盘」标签生效。
- 回归：6 页 + `/api/history|similarity|market/overview|similarity/current|market/candles|market/funding` 均 200；21 事件 + 21 截图完整；非法输入 `coin=INVALID→invalid_coin`、`history/INVALID→404`、`/asset/btc→404` 正确。
- 已知限制：本环境无真实浏览器，仅做 SSR HTML + API + 纯函数映射验证，未做 hydrated 像素级验证（`ACTION_CARD_REPORT §9` 同口径）。

---

## QA-2026-09-18｜PRODUCT_PLAN_V0.2 观察盘 MVP（CODE_REVIEW 终核 PASS 后）

- 基线：DEV_BASELINE=PRODUCT_PLAN_V0.2；CODE_REVIEW 终核 PASS（2026-09-18）
- 单元/类型：`pnpm test` 212/212 通过；`pnpm ts-check` exit 0
- 接口（dev PORT=5123，`SQLITE_DB_PATH=/tmp/qa-5123.db`，已杀进程、已删临时库，`var/` 无残留）：
  - `GET /` → 200
  - `GET /api/config` 默认 `tier:4`（slots 全空、persisted:false）→ 符合“首次默认 4 卡”
  - `PUT /api/config` tier 6（PEPE/DOGE/ETHFI＋3 空槽）→ ok:true；`GET` 确认持久化 persisted:true
  - 一币多卡 `PUT slots=[PEPE,PEPE,DOGE,ETHFI]` → 400＋“一币一卡”错误，未污染已存配置
  - 未启用标的（BTC/SOL/XRP）→ 拒绝写入（ok:false＋逐槽错误）
  - `GET /api/assets` 200：enabled=[PEPE,DOGE,ETHFI]，reference=[BTC]，candidates 因沙箱无外网 status=unavailable（预期）
  - 重启后 `GET /api/config` → tier 6 配置仍在（persisted:true）
- 无胜率表述：`rg 胜率|准确率|开仓 src/` 命中均为合规反向声明（“不输出胜率…”/“不是开仓信号”/禁语表），ActionCard/实时信号/报警无概率化收益表述 → 通过
- 沙箱记账：`/api/market/overview` status=unavailable（OKX DNS 墙 EHOSTDOWN 169.254.0.2），`/api/market/candles` → 503 真实诊断；属预期，不判缺陷
- 真机预检：本轮为 API＋SSR 验证，无真机 session，记 NOT_VERIFIED（未做 hydrated 像素级验证）
- 结论：PASS，新 BUG 0（沿用既有 BUG-001/002/003＋INFO，不新增）

## QA-2026-09-18-生产真机（headless Chromium，无头，不碰用户键鼠）

- 范围：`066f76d` 部署后生产站（含 Vercel 只读 FS 修复）
- 整改验证：`/api/config` 200（默认 4 卡）；PUT 6 档 ok → 改回 4 档 ok；重复卡 PUT → 400；`/api/assets` 200
- 页面/API 全绿：`/`、三详情页、history、similarity、methodology、overview、health、candles、funding、history、similarity/current 全部 200；similarity ETHFI 按设计 400
- 无头渲染：首页观察盘/卡片正常，JS 报错 0；6 档按钮可点；ETHFI 详情「未知/缺失」在位
- 胜率：唯一命中为禁令声明文案（“不输出胜率…”），无概率化收益表述
- Vercel 声明：WatchBoard＋页脚「Vercel 生产环境不保证跨部署保存」在位
- 截图：/var/folders/mp/mnxk3h8x4wq5ztr7__vlplp40000gn/T/opencode/qabrowser/qa-home.png、qa-ethfi.png（工作区外，不进仓）
- 结论：PASS，新 BUG 0

## QA-2026-09-18-第二轮｜market-service 动态化＋备份脚本回归（P1 两项）

- 基线：DEV_BASELINE=PRODUCT_PLAN_V0.2；CODE_REVIEW 第二轮 PASS（2026-09-18，P1-blocking 0）
- 单元/类型：`pnpm test` 214/214 通过；`pnpm ts-check` exit 0
- 接口（dev PORT=5123，`SQLITE_DB_PATH=/tmp/qa-5123-recheck.db`，已杀进程、已删临时库，`var/` 无残留）：
  - `GET /` → 200
  - `GET /api/config` → ok:true，默认 tier:4（slots 全空、persisted:false）
  - `GET /api/assets` → 200：enabled=[PEPE,DOGE,ETHFI]，reference=[BTC]，candidates status=unavailable（沙箱无外网，预期）
  - `GET /api/market/overview` → 200：`data.signals` 含 PEPE/DOGE/ETHFI；legacy 小写字段 `data.pepe/doge/ethfi` 在（沙箱无网为 null，预期）；`data.prices` 含 BTC/DOGE/ETHFI/PEPE；status=unavailable（OKX DNS 墙，预期，不判缺陷）
- 备份脚本：`bash scripts/backup-sqlite.sh --help` 正常输出用法（backup/verify 两命令＋环境变量说明）
- 无胜率表述：`rg 胜率 src/` 命中均为合规禁令声明（BANNED_COPY_WORDS／页脚“不输出胜率…”／测试断言），无面向交易决策的概率化收益表述 → 通过
- 真机预检：本轮为 API＋SSR＋纯函数验证，无真机 session，记 NOT_VERIFIED
- 结论：PASS，新 BUG 0（沿用既有 BUG-001/002/003＋INFO，不新增）

## QA-2026-09-18-第三轮｜核验启用闭环回归（CODE_REVIEW 终核 PASS 后）

- 基线：DEV_BASELINE=PRODUCT_PLAN_V0.2；CODE_REVIEW 第三轮终核 PASS（2026-09-18，mapVerifyOutcomeToHttp＋四分支测试）
- 单元/类型：`pnpm test` 226/226 通过；`pnpm ts-check` exit 0（tsc 无输出）
- 接口（PORT=5123，`GET /` → 200）：
  - `GET /api/assets` → 200：`enabled=[PEPE,DOGE,ETHFI]`，`candidates.status=unavailable`（沙箱 OKX DNS 墙 EHOSTDOWN，预期）＋`items` 含三币启用记录（verified:true，ETHFI hasHistoryBaseline:false）
  - `POST /api/assets/verify {"id":"UNKNOWNXXX"}` → 422＋`ok:false`＋checks[resolve].ok=false“未知标的…不在 OKX 永续候选目录”（P1-blocking route 级 422 映射行为在位）
  - `GET /api/config` → 200：默认 `tier:4`（slots 全空、persisted:false），符合“首次默认 4 卡”
- 无胜率表述：`rg 胜率|准确率` 命中仅合规禁令声明（页脚“不输出胜率…”、methodology DISCLOSURES、“不输出胜率与开仓建议”）＋alert-center 禁语表/测试断言；无面向交易决策的概率化收益表述 → 通过
- 端口记账：`:5123` 上有本任务开始前已存在的监听进程（PID 14269，13:30 起，未动）；自起 dev 因 `.next/dev/lock` 冲突未能绑定，API 实测走该既存实例（同一工作树代码），自起进程已杀、`/tmp/qa-5124*` 与 `/tmp/qa-5123-verify*` 已删，`var/` 不存在无残留
- 真机预检：本轮为 API＋SSR＋grep 验证，无真机 session，记 NOT_VERIFIED
- 结论：PASS，新 BUG 0（沿用既有 BUG-001/002/003＋INFO，不新增）

## QA-2026-09-18-生产真机核验启用E2E（headless，不碰用户键鼠）

- 起因：用户真机搜 HYPE/XMR 显示 463 候选全未启用、无法选中
- 根因两处：①核验→启用闭环缺失（已补）；②OKX funding-rate 解析用错字段（realizedRate→fundingRate，HYPE 无 Binance 链路故暴露），已修 `07b9670`
- 生产 E2E（截图 qabrowser/qa-hype-enabled.png）：搜 hype → 候选 HYPE「核验并启用」→ 通过 → 已启用(1)＋无研究基线 badge＋放入按钮；池 466＝4 已启用＋462 待核验；JS 报错 0
- 注意：Vercel /tmp 实例级持久，换实例后需重核验（已声明）；HYPE 在生产某实例已启用
- 结论：PASS，可用

## QA-2026-09-18-第四轮｜market-client 代理 plumbing 回归（CODE_REVIEW PASS 后）

- 基线：DEV_BASELINE=PRODUCT_PLAN_V0.2；CODE_REVIEW 第四轮 PASS（2026-09-18，P1-blocking 0）
- 单元/类型：`pnpm test` 234/234 通过；`pnpm ts-check` exit 0（tsc 无输出）
- 接口（本轮未自起 dev：`scripts/dev.sh` 硬编码 PORT=5000 且 `.next/dev/lock` 被既存 :5000 实例占用，未杀他人进程；API 实测走既存 :5000 实例，同一工作树代码）：
  - `GET /api/assets` → 200：`candidates.status=live`，`total=466`（`candidateCount=463`＋`enabledCount=3`），enabled=[PEPE,DOGE,ETHFI]——此前沙箱 DNS 墙 unavailable，修完已变 live＋总数>0，符合预期
  - `GET /api/market/overview` → 200：`ok:true`，`data.status=live`，keys 含 btc/signals/pepe/doge/ethfi/prices/sources——此前 unavailable，已变 live
  - 环境：shell 带 `HTTP_PROXY/HTTPS_PROXY/ALL_PROXY`（127.0.0.1 本地代理），即代理 plumbing 生效路径
- 无胜率表述：`rg 胜率|准确率` 命中仅合规禁令声明（methodology 页“不输出胜率…”×3、action.ts 注释、禁语表/测试断言）；ActionCard/实时信号无概率化收益表述 → 通过
- 临时文件：自起 5123 进程已杀（未绑定成功，无残留服务）；`/tmp/qa-5123-proxy.*` 已删；`var/dev.db*` 为既存 :5000 实例产物（gitignored），未动
- 真机预检：本轮为 API＋grep 验证，无真机 session，记 NOT_VERIFIED
- 结论：PASS，新 BUG 0（沿用既有 BUG-001/002/003＋INFO，不新增）

## QA-2026-09-18-生产真机HYPE详情E2E（headless）

- JIT 即时核验＋服务端初值＋公开数据候选可读上线后：/asset/hype 200（此前跨实例 404）
- 整套框架同口径：行动卡（突破跟踪＋价格/突破位/失效位/为什么/接下来观察）、BTC 环境、分层评分、K 线图、资金费率、信号判断依据、无基线未知/缺失、历史形态(0)
- JS 报错 0；截图 qabrowser/qa-hype-detail2.png（工作区外）
- 结论：PASS
