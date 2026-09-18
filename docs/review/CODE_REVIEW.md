
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
