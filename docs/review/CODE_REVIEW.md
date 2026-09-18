
# CODE REVIEW

- Task: PRODUCT_PLAN_V0.2 观察盘（注册表＋4/6/9 布局＋SQLite 配置＋选择器）
- Commit: 基线 d8205d1..HEAD（已提交仅 USER_MODEL_OVERRIDE.md）＋ 工作区未提交改动（registry.ts / layout.ts / server/sqlite.ts / server/layout-repository.ts / db/schema.sql / db/migrations/0001_init.sql / api/config / api/assets / WatchBoard.tsx / AssetPicker.tsx / overview 映射 / market-client OKX 目录 / SignalCard 研究隔离 / page 文案 / .gitignore）
- Reviewer: code-reviewer（本窗口）
- Result: CONDITIONAL（2 项必须改，改完可过；禁改业务代码——以下均为 builder 改法指引）

> Dispatch / Evidence ID 系字段 2.0 已废弃，不填。

## P0 / P1 Findings

- P1-blocking（必须改 1）：Vercel 非持久化声明缺失。DoD 明确要求"产品说明必须明确 Vercel 配置不保证跨实例或跨部署保存"，但本轮 UI（WatchBoard 保存态"已保存"）与 page 文案均无此说明，用户在生产环境会误以为配置可靠持久。改法：WatchBoard 保存态旁或配置区加一行小字"本地 SQLite 持久化；Vercel 生产环境不保证跨部署保存"，methodology 或页脚同步一句；纯文案，不碰逻辑。
- P1-blocking（必须改 2）：WatchBoard CandleFreshnessBlock 硬编码 `slice(0, 3)` 且类型断言只列 PEPE/DOGE/BTC/ETHFI（WatchBoard.tsx:242-253）。当前 overview 只有三币所以功能无损，但与"动态标的映射"目标直接冲突：新增第 4 个启用标的后其新鲜度块永远不渲染，且 TS 类型会先报错。改法：改为按 `config.slots` 全量渲染（去空槽），类型改为 `Record<string, …>`；与 `signals/prices` 动态映射保持一致。
- P1-非 blocking（不拦本轮，记入 QA/后续）：备份与恢复演练缺失。sqlite.md §11/§12 与 DoD 要求每日备份、部署前备份、隔离恢复验证（integrity_check / foreign_key_check / schema version / 业务读取），本轮只有 Migration＋事务，无任何备份脚本或文档步骤。改法：后续独立任务补 `scripts/backup-sqlite.sh`＋恢复演练记录；本地 MVP 可先用，若上 Docker 正式部署前必须补。
- P1-非 blocking：overview 仍只产出 PEPE/DOGE/ETHFI 三币（market-service 未动态化），`signals` 映射只是换皮。当前启用集合恰为三币所以自洽；一旦有第 4 个 enabled 标的，卡片将恒显示缺失。改法：后续任务把 market-service 改为按 enabled 注册表去重拉取（plan 已要求 instrument 去重＋限频＋缓存）；本轮不拦。

## P2 / P3 Backlog Findings

- P2：`normalizeLayout`／`fillSlots` 等默认参数 `registry = getEnabledAssets()` 在调用方未传 registry 时每次重建 seed 注册表，快照测试外无大碍；建议调用方显式传 registry（WatchBoard 首屏 `normalizeLayout(config)` 即属此类，当前 seed 恰为三币所以正确）。
- P2：`/api/assets` 每次 GET 都拉 OKX 全量 SWAP 目录（无缓存），候选池规模大时增加限频风险；后续加内存缓存（market-client 既有模式）。
- P2：`SEED_VERIFIED_AT` 写死 `2026-09-18T00:00:00Z` 作为三币核验时间戳，属"自声明核验"而非逐币清单证据；与 Plan"执行期建立逐币核验清单"一致，记得补清单时替换为真实核验时间。
- P3：`registerCandidates` 用 `symbol` 推导 `id`（`instId.replace('-USDT-SWAP','')`），非 USDT 永续（如 BTC-USD-SWAP 类）id 推导会带后缀；当前过滤只留 `-USDT-SWAP` 所以无事，后续放宽过滤时注意。

## 红线核查（全部通过）

- 量化红线：indicators.ts / config.ts（阈值权重）/ state-machine.ts / v2/engine.ts 本轮零改动（diff 为空）；registry.ts 显式声明不复制阈值逻辑，实际也未引用。
- 研究隔离：SignalCard 对 `!hasHistoryBaseline` 显示"未知/缺失"；AssetPicker 标"无研究基线"；候选池仅计数＋样例、不进信号；ETHFI 沿用既有 `hasHistoryBaseline=false`。通过。
- 无未来数据：新增模块均为配置／注册表／布局纯函数，无 K 线消费；market-client 新增仅读 OKX 公开目录。overview `signals` 映射与原字段同源，无新增未来引用。通过。
- 无胜率表述：全轮 grep 仅 SignalCard 一处"Precision / Recall / FPR / Success Rate…未知/缺失"（合规的反向声明）；WatchBoard/AssetPicker/ActionCard 无概率化收益表述。通过。
- SQLite 合规（docs/sop/sqlite.md）：project_slug=pepe-doge-breakout-radar；一项目一库＋单例；`SQLITE_DB_PATH` 注入、无硬编码宿主机路径；Migration 进 Git、`.db` 被排除（`*.db`＋`/var/` 覆盖 `var/dev.db`）；FK=ON＋WAL＋busy_timeout；集中 Repository、浏览器经 HTTP API；schema_version 校验＋损坏回退＋事务写入。备份／恢复为例外缺项（见 P1-非 blocking）。
- 测试：`pnpm test` 212/212 通过（含新增 registry 5＋layout 7＋config-repository SQLite 11 项，覆盖状态门／4-6-9／一币一卡／补位／收藏搜索逻辑／Migration 幂等／损坏恢复／重启持久化语义）；`npx tsc --noEmit` 通过（exit 0）。

## 终核（第二次返工，2026-09-18）：PASS —— WatchBoard.tsx:236-238 与 DataStatus.tsx:144-146 均已为 Record<string,…>，slice(0,3) 已移除改按 config.slots 全量渲染；pnpm test 212/212＋tsc exit 0 全绿。

## 第二轮复审（market-service 动态注册表拉取＋备份脚本，2026-09-18）

- Task: CHANGE C 范围内 market-service 动态化＋SQLite 备份补齐（DEV_BASELINE=PRODUCT_PLAN_V0.2）
- Commit: 工作区未提交改动（market-service.ts / market-client.ts / registry.ts / overview route / market-service-isolation.test.ts DYNAMIC-1/2 / scripts/backup-sqlite.sh / docs/qa/SQLITE_BACKUP_RESTORE.md）
- Reviewer: code-reviewer（本窗口，只审不改）
- Result: PASS（P1-blocking 0；P1-非 blocking 1；P2 2；以下均为后续任务指引，不拦本轮）

## P0 / P1 Findings

- P1-非 blocking（不拦本轮，记后续）：candle 明细路径仍为固定四键。buildMarketOverview 内 deriveCandleOverviewFreshness 调用只传 PEPE/DOGE/BTC/ETHFI 四键，overview route 的 perCoin 映射（34-53 行）同样只列四键；第 4 个 enabled 标的可经 signals/prices/freshnessByCoin/fundingTs 正常出信号与卡片，但其 candleLag/期望收盘明细不在 API 暴露。改法：后续任务把 candle 明细改为按 assets 动态键控（或明确声明 candle 明细仅覆盖核心四键、第 N 标的走 freshnessByCoin 口径）；本轮三币行为无损，不拦。
- 无 P0；无 P1-blocking。

## P2 / P3 Backlog Findings

- P2：overview route 仍以默认参数调用 getMarketOverview()（即 seed 注册表），未接入 SQLite 用户配置的 enabled 集合。getMarketOverview(registry) 已支持注入、buildMarketOverview 已动态键控（DYNAMIC-1/2 覆盖），所以本轮"拉取集合注册表派生＋去重"目标达成；端到端"用户在观察盘启用的第 4 币自动进入拉取集合"需后续任务决定 route 是否读服务端配置（stateless route 读 SQLite 的取舍由 TM 定）。当前 seed 恰为三币，行为自洽。
- P2：analyzeAssetV2 对动态标的以 `a.id as AssetId` 传入（测试内合成 WIF 同理）。运行时与 ETHFI 既有口径一致（同阈值同权重），类型上绕过了 AssetId 联合约束；后续若 AssetId 扩展或引擎收紧签名，记得同步放宽类型而非新增 cast。
- P3：backup-sqlite.sh 与 SQLITE_BACKUP_RESTORE.md 注释/示例中出现 `/Users/zzymima0000/DockerBackups/...` 与 `/app/data/db/...` 示例路径。均为注释与文档示例、可执行逻辑全走环境变量（SQLITE_DB_PATH / SQLITE_BACKUP_DIR 默认 repo 相对路径），不算硬编码；后续复用文档时注意示例路径随部署环境替换即可。

## 红线核查（全部通过）

- 量化红线：indicators.ts / config.ts（阈值权重）/ state-machine.ts / v2/engine.ts 本轮 diff 为空，零改动；registry 新增 fundingBinanceSymbol 仅转述 config.ASSETS 单一来源，未复制阈值逻辑。通过。
- PEPE/DOGE/ETHFI 行为不变：legacy 字段保留（service 内 pepe/doge/ethfi 取自 signals 同源；route 继续透出）；全局门控仍只看 BTC+PEPE+DOGE（CORE_IDS），其余标的不拖垮全局；peer 口径 PEPE↔DOGE 互为 peer 不变，其余标的取两者均值（与 ETHFI 既有口径一致）。ISOL-A1~A5/C1 全部仍过，确认无回归。通过。
- 备份合规：可执行逻辑无硬编码宿主机绝对路径（环境变量优先，默认 repo 相对路径）；备份用 `.backup` 在线快照、拒绝直接 cp；verify 先 cp 到 mktemp 隔离目录再只读检查（integrity_check / foreign_key_check / schema version / watch_layout 业务读取）；恢复替换不在脚本内自动执行，文档明确"用户批准后才允许替换生产"＋三条禁止（未验证覆盖/开发库覆盖生产/删全部历史备份）。通过。
- 无胜率表述：本轮 diff grep（胜率/准确率/win rate/precision/recall）仅命中测试内 fundingOk 样例 symbol 与既有注释，无面向交易决策的概率化收益表述；研究指标未进入信号/报警。通过。
- 测试：`pnpm test` 214/214 通过（212 基线＋新增 DYNAMIC-1/2 两项：WIF 合成第 4 标的出信号＋映射；WIF 故障只降级自身）；isolation 单文件 9/9；DYNAMIC 断言覆盖 signals/prices/freshnessByCoin/fundingTs/errors 四类，真覆盖非摆设。

## 第三轮复审（核验启用闭环，2026-09-18）

- Task: 核验启用闭环（DEV_BASELINE=PRODUCT_PLAN_V0.2）
- Commit: HEAD 起工作区 diff（db/migrations/0002、registry.ts VerificationCheck/applyVerifications、asset-verification.ts、server/asset-verification-repository.ts、server/registry-service.ts、api/assets/verify/route.ts、AssetPicker 核验按钮、WatchBoard 接线、SignalCard meta 覆盖、asset-verification.test.ts；market-client tickSz/lotSz/minSz 透出；market-service/layout-repository 默认注册表切 getServerRegistry）
- Reviewer: code-reviewer（本窗口，只审不改）
- Result: CONDITIONAL（P1-blocking 1；P0 0；P2 3；改法均为 builder 指引）

## P0 / P1 Findings

- P1-blocking（必须改 1）：verify 失败路径缺 route 级 422 映射测试。asset-verification.test.ts 真覆盖了核验逻辑失败分支（资金费率单项失败／精度缺失／K 线过短／429 限频／未知标的／ok=false 不得启用，16/16 通过已复跑），但 `POST /api/assets/verify` 的三个 HTTP 分支（未知标的→422、outcome 未过→422 写清首个失败项、db 为 null→503 未启用）无任何测试覆盖；分支内 message/checks 组装（WatchBoard 错误展示依赖 `body.checks`＋`message` 形状）一旦改错，单测全绿也拦不住。改法：加 route 级测试（注入假 deps 或抽 `verifyAssetById`＋db 为 null 双 double，断言三分支 status＋`ok:false`＋checks 非空＋失败后无落库）；或由 QA 以真机 422 用例书面认领，supervisor 确认后可降级。
- 无 P0；其余 P1 全部通过：任一失败不得 enabled（route 先判 `!asset`→422、再判 `!outcome.ok`→422，最后才 saveVerification；repository 仅全过调用；applyVerifications 只认 `ok===true` 记录，损坏 JSON 降解为 ok=false；WatchBoard 失败只置 verifyState error、不刷新启用列表）。通过。

## P2 / P3 Backlog Findings

- P2：getServerRegistry 默认参数每次调用 tryOpenDb（market-service/layout-repository 默认值）。功能正确（读失败降级 seed），仅多一次 open 尝试；后续可由调用方显式传 registry 或缓存 seed＋records 合并结果。
- P2：applyVerifications 再水化新标的用 `name=symbol=id`＋固定灰色 themecolor＋sortOrder 20_000+。与候选注册口径一致、可接受；后续若 OKX symbol 与展示名分化，记得补 name 映射而非沿用 id。
- P2：0002 迁移无 down（与 0001 同策略，IF NOT EXISTS 幂等已由 config-repository 单测覆盖）。回滚靠代码版本＋备份脚本，不新增 down 文件；记一笔即可。
- P3：无。

## 红线核查（全部通过）

- Quant 红线零改动：indicators.ts / state-machine.ts / v2/engine.ts 本轮 diff 为空；config.ts 仅被 asset-verification.ts 只读 `DEFAULT_V2_THRESHOLDS.breakoutLookbackCandles + 1` 作最小 K 线数，未复制未修改阈值/权重/状态机。通过。
- seed 三币行为不变：applyVerifications 空记录时三币仍 enabled（单测已断言 PEPE/DOGE/ETHFI）；CORE_IDS 与 legacy 字段未动；market-service 默认注册表由 seed 切 getServerRegistry（seed＋已持久化记录，无记录时恒等于 seed）。通过。
- ETHFI 无基线隔离仍在：新水化标的 `hasHistoryBaseline:false`；SignalCard 对无基线显示"未知/缺失"（metaOverride 透传注册表值，内置 ASSETS 缺键时回退灰色未知）；再水化 HYPE 断言 source=okx＋无基线。通过。
- 无胜率表述：新增文件 grep（胜率/买入/概率化收益）零命中；仅 AssetPicker 一处注释"文案不输出任何胜率/收益表述"的方法论声明；checks detail 均为数据源证据句。通过。
- 测试：asset-verification.test.ts 8 项＋config-repository（含 0002 幂等断言）共 16/16 通过（已复跑）；失败路径为真覆盖（注入假 deps，无网络）。route 级 422 映射为例外缺项（见 P1-blocking）。

## 终核（P1-blocking 闭环，2026-09-18）：PASS —— mapVerifyOutcomeToHttp 纯函数存在（asset-verification.ts:238），四分支测试真覆盖且断言形状（未知422/未过422/503/200，asset-verification.test.ts:229-279）；route 已改调该函数、无重复映射逻辑（route.ts:38-41）；pnpm test 226/226＋tsc exit 0 全绿。

## 第四轮复审（market-client 代理 plumbing，2026-09-18）

- Task: market-client 代理 plumbing（本地 dev 经 HTTP(S)_PROXY 直连 OKX；生产无变量零影响）
- Commit: HEAD 起 diff（market-client.ts / market-client-proxy.test.ts untracked / package.json＋pnpm-lock undici）
- Reviewer: code-reviewer（本窗口，只审不改）
- Result: PASS（P0 0；P1-blocking 0；P2 2；问题数 2；以下均为后续指引，不拦本轮）

## P0 / P1 Findings

- 无 P0；无 P1-blocking。无变量路径：getRequestDispatcher 返回 undefined→undiciFetch 走 Node 默认 dispatcher，与原全局 fetch 同为 undici 内核、同一 signal/headers/cache 透传，生产（无代理变量）零影响成立；有变量仅 init.dispatcher 附加 ProxyAgent，只改线路。fetchOnce 其余逻辑（ok 判定/抛错归类/缓存限频）零改动。

## P2 Backlog Findings

- P2：readProxyUrl 不认 ALL_PROXY/all_proxy，但测试 save/restore 清理了该键。当前行为＝显式只支持 HTTP(S)_PROXY 四键、ALL_PROXY 被忽略；若用户配了 ALL_PROXY 会静默直连失败。改法（二选一）：要么 readProxyUrl 追加 ALL_PROXY 回退，要么注释声明"ALL_PROXY 不支持"；测试任选一分支断言即可。
- P2：旧 agent 切换时 `void close().catch(()=>{})` 无日志。同一进程切代理地址时旧连接静默关闭，排障无痕。改法：console.debug 一句或注释说明即可；不拦。

## 红线核查（全部通过）

- Quant 红线零改动：indicators.ts / config.ts / state-machine.ts / v2/engine.ts / event-analysis.ts 本轮 diff 为空。
- undici 新增依赖必要：实证根因成立——外置 ProxyAgent dispatcher 与 Node 内置 fetch 跨 undici 版本符号不互通，全链改用外置 undiciFetch 是正确解；只用内置 fetch 无法注入代理 dispatcher。版本 ^8.10.2 与 Node 22 无冲突（pnpm test＋tsc 全绿为证）。
- 测试真覆盖非摆设：PROXY-U1/U2/U3＋E1 共 4 项（显式 env 隔离 shell 真实代理；U3 断言同地址实例复用＋无变量回退；E1 经本地回环代理桩断言 CONNECT 命中 okx.com:443 且未触达外网）。
- 测试：`pnpm test` 234/234 通过（226 基线＋新增 8 项含 PROXY 4＋asset-page 4，未单独跑 tsc 但 esbuild/tsx 加载即验类型导入）。

---

## JIT＋公开数据读取放宽轮（HEAD diff 5 文件）

- Task: registry-service resolveEnabledAssetJIT＋asset/[coin] JIT＋服务端initial初值＋AssetDetail回退＋candles/funding候选可读放宽
- Commit: HEAD 未提交 diff（registry-service.ts / asset/[coin]/page.tsx / AssetDetail.tsx / candles/route.ts / funding/route.ts）
- Reviewer: code-reviewer（本窗口，只审不改）
- Result: PASS（P0 0；P1-blocking 0；P2 2；问题数 2；以下均为后续指引，不拦本轮）

## P0 / P1 Findings

- 无 P0；无 P1-blocking。

## P2 Backlog Findings

- P2：candles/funding 未知币仍回 400 invalid_coin（非 404）。沿用既有口径（本轮只改 message 文案），详情页未知/失败仍 notFound() 不变；若后续要统一 API 未知语义再议，不拦。
- P2：JIT 每次未命中都拉 OKX 全目录＋跑真实核验，无负缓存。未知币反复刷详情页会重复打目录/核验链路；后续可加短 TTL 负缓存，不拦。

## 红线核查（全部通过）

- Quant 红线零改动：本轮 diff 仅 5 文件，indicators.ts / config.ts / state-machine.ts / v2/engine.ts / event-analysis.ts 零触碰。
- 启用门未被绕过：卡片/选择器无改动仍只认 enabled；放宽的只是 candles/funding 公开数据读取（OKX 目录在列即读）＋详情页 JIT（真实 verifyAssetById 通过才回 enabled 并落库，失败/未知返回 null→404）。
- 失败/未知仍 404：asset page 保留 `if (!asset) notFound()`，JIT 仅 candidate＋outcome.ok 才返回；目录不可用/非 candidate/核验不过一律 null。
- 无胜率表述：grep 本轮文件零命中；全仓唯一命中为 AssetPicker 既有合规注释行。
- initial 初值无闪断假信号：服务端同请求同实例直出 signal/price/freshness，客户端仅作 `?? initial` 回退，不覆盖 overview 实测值；live 取 `overview ? status==='live' : initial.live`，语义正确。

---

# CODE REVIEW — Web 推送 MVP（e2e277d）

- Task: Web 推送 MVP（服务端检查循环＋VAPID＋订阅落库＋sw 全局通知，本地单用户）
- Commit: e2e277d（HEAD~1 起 diff，19 文件 +1091/-2）
- Reviewer: code-reviewer（本窗口，只审不改）
- Result: PASS（P0 0；P1-blocking 0；P1-非blocking 2；P2 2；问题数 4；均不拦，可直接进 QA）

## P0 / P1 Findings

- 无 P0；无 P1-blocking。
- P1-非blocking（1）：unsubscribe 路由 `deletePushSubscription` 未包 try/catch（subscribe 有，unsubscribe 无）。DB 异常时 Next 默认 500 且无 `ok:false` 信封。改法：与 subscribe 同式包 try/catch 回 `{ok:false,error}` 500。
- P1-非blocking（2）：`savePushSubscription` 手动 `BEGIN/COMMIT` 无嵌套事务保护；若调用方未来在事务内调用则 `BEGIN` 直接抛。改法：用 `db.transaction()` 包装或先查 `PRAGMA`/inTransaction；当前单调用点无事，记后续。

## P2 Backlog Findings

- P2：`countPushSubscriptions` 全表读后取 length（O(n) 反序列化），订阅量大时可改 `SELECT COUNT(*)`。本地单用户无影响。
- P2：`readPushSubscriptions` catch 全吞返回 `[]`，发送轮会误判为"无订阅"并重置基线（丢一次检查节拍）。建议区分"表缺失"与"DB 错误"日志一句；不拦。

## 红线核查（全部通过）

- Quant 红线零改动：推送层只消费 `deriveActionState` 结果（`collectActionObservations` 经 `actionInputFromSignal` 组装）；push.ts/push-service.ts 无阈值/权重/状态机/回测引用；PUSH7 测试逐项断言（mfe-mae/MFE/MAE/outcome/backtest/samples/DEFAULT_V2_*）；全仓测试 241/241 PASS。
- 密钥禁进 Git：`.env.local`＋`.env.*.local`＋`vapid-keys*.json`＋`*.vapid.json` 已入 .gitignore；`git check-ignore .env.local`=IGNORED；`git ls-files` 无 .env.local、无私钥/订阅数据（真实 .db 被 *.db 排除；迁移 0003 仅建表结构）。
- sw.js 无敏感信息：仅 push 展示＋click 聚焦/导航，无密钥、无 endpoint 回传、无 fetch。
- 文案禁语：diff 内"买入/胜率/概率/必涨"仅 3 处禁语声明注释；payload 复用 alert-center ALERT_COPY＋buildAlertBody，PUSH5 逐 action 断言禁语表＋四字段（title/body/tag/url）＋NO_ACTION→null。
- 订阅校验：`isValidPushSubscription`（endpoint/p256dh/auth 非空 trim）＋路由 400（invalid_subscription）＋repository 内二次校验抛 `push_subscription_invalid`；upsert 幂等（ON CONFLICT 覆盖 keys＋刷新 created_at），PUSH6 覆盖增删读＋校验。
- 检查循环不崩进程：`startPushCheckLoop` 未配置 VAPID 只 warn 跳过；`setInterval` 回调 `.catch` 记日志；`sendPushToAll` 单订阅失败隔离（404/410 清理、其余计数＋console.error）；`runPushCheckOnce` 冷启动只建基线不重报、无订阅不拉行情；`timer.unref()` 防 hanging。
- 测试真覆盖：PUSH1–PUSH7（迁移幂等＋版本链／边沿冷启动／去重键／订阅过滤／禁语／落库校验／禁未来数据）＋ `resetPushCheckStateForTests` 防串状态。

## 卡槽紧凑化专项复审（2026-09-18）
- 范围：src/lib/layout.ts（compactSlots/normalize/fillSlots/assignSlot）、layout-repository.ts（notice计数）、WatchBoard空槽守卫、layout.test.ts；`git diff HEAD` 未提交改动。
- Result: CONDITIONAL（问题数：P1×0 / P2×2 / P3×1；无P0）
- P2-1：assignSlot 非null绑定同样走compactSlots，会附带前移（如 [PEPE,null,DOGE,null] 在3号槽放入ETHFI后DOGE从index2移到1）。与"不串改"注释存在张力；若为有意语义需在注释写明"任何写入均紧凑化"，否则仅null移除时紧凑。
- P2-2：WatchBoard空槽守卫 `i >= usedCount` 依赖"紧凑不变式"（compact后空槽仅在末尾才成立）。若服务端返回历史非紧凑布局且未经normalize直接渲染，中空位置将被渲染为null（卡片消失而非空槽按钮）。建议渲染前对config.slots做一次normalize或以 `assetId==null` 为空槽判据。
- P3：任务称layout.test.ts 17项，实测 `node --import tsx --test src/lib/layout.test.ts` 为14/14 PASS；数量口径对不上，建议核对是否漏算/指全仓数。
- 通过项：删卡相对顺序不变（PEPE,DOGE,ETHFI删中卡→DOGE,ETHFI；删尾卡位置不变）；一币一卡不破（normalize去重保留首个＋紧凑、assignSlot拒他槽重复、validate一币一卡报错口径不变）；持久化语义不变（schemaVersion/tier/slots长度/favorites口径未动，validate对紧凑布局ok，notice计数仅从位置口径改为集合口径、dropped语义基本等价）；Quant红线零改动（diff仅布局/展示层）。
- 验证：layout.test.ts 14/14 PASS。

## 导航去三币Tab＋详情动态化专项复审（2026-09-18）
- 范围：`git diff HEAD` 7文件（SiteHeader/WatchBoard/asset/[coin]/page/history/page/similarity/page/HistoryGrid/SimilarityView）；工作区未提交。
- Result: PASS（问题数：P0×0 / P1×0 / P2×2 / P3×0；Quant红线零改动）
- 通过项：
  - 旧硬编码清干净：SiteHeader 删 PEPE/DOGE/ETHFI 三 Tab（NAV 仅总览/历史/相似性/方法论）；全仓 grep `/asset/PEPE|/asset/DOGE|/asset/ETHFI` 零残留（大写路径）；小写动态 `/asset/${asset.id}`（WatchBoard详情入口）＋ generateStaticParams 小写三币属正常动态路由。
  - 无基线不混分母：HistoryGrid/SimilarityView 均 `hasBaseline=false → emptyBaseline` 短路渲染空缺态，不渲染计数/网格/散点/邻居；筛选后计数 `filtered.length`/`visibleEvents.length` 仅基线事件派生；空缺文案"暂无历史基线样本（现有基线为 PEPE 11 + DOGE 10），空缺不计入统计分母，相似性与研究指标一律「未知/缺失」，禁编造"——无编造、无概率化收益表述。
  - 无胜率表述：diff 内无胜率/准确率/Precision/Recall/FPR/Success 数值输出；全仓 grep 命中均为既有合规项（禁语表/方法论/测试断言/SignalCard-AssetDetail"未知/缺失"反向声明）。
  - 面包屑守卫正确：asset 页 `hasBaseline` 才挂"全部历史样本"链；形态相似性链常挂（相似页自身对无基线币走空缺态，自洽）；返回观察盘常挂。
  - Quant红线零改动：diff 仅导航/筛选/空缺态展示层，未碰 indicators/config阈值权重/state-machine/v2/engine。
- P2-1：SimilarityView"当前像谁"硬编码 PEPE/DOGE（pepeCur/dogeCur 双 useApi＋`coin==='PEPE'/'DOGE'` 条件渲染）。当前基线恰为 PEPE 11+DOGE 10所以自洽；未来若有第3个有基线币，其 current 相似性无入口。后续动态化时按 coins（hasBaseline）逐币拉取。
- P2-2：HistoryGrid `ASSETS[e.coin]` 无 fallback、SimilarityView 三处 `ASSETS[... as 'PEPE'|'DOGE'|'ETHFI']` 强断言。当前事件仅 PEPE/DOGE所以无事；未来新基线币事件进入即 TS/运行时双风险。建议统一 `??` fallback 或随注册表动态化。
- 验证：`pnpm test` 245/245 PASS。
