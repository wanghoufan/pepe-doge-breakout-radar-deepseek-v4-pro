
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
