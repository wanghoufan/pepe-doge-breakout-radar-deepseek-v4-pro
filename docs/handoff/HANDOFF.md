# HANDOFF｜交接（暂停/恢复用，先读我）

> 旧版字段（governance-state / Evidence / Human Gate / Promotion / Dispatch ID）已废弃，不填。

- Captured at（YYYY-MM-DD HH:MM）：2026-09-18 15:00
- PROJECT_PHASE：DEVELOP（Human Gate 已批准；DEV_BASELINE=PRODUCT_PLAN_V0.2）
- PLAN_VERSION：PRODUCT_PLAN_V0.2
- PLAN_READINESS_SCORE：94（第二轮 PASS）
- PLAN_GATE：APPROVED
- DEV_BASELINE：PRODUCT_PLAN_V0.2（Phase2 锁定，变更只走 Change C）
- CHANGE_REQUEST：C（已成立：加币＋注册表重构＋SQLite 配置；范围以 V0.2 为准）
- Stage ID（本阶段叫什么）：多标的观察盘 MVP＋P1 收尾＋核验启用闭环＋详情动态化＋代理分支（radar-live）
- 剩 P0（没完的才列，多一条都不行）：等用户 watchlist（常看币名单），到后批量核验启用（A 方案；B 全量 463 备选）
- 人类5决策回执（2026-09-18 12:55，用户原话收录）：①首批币=交易所公开可拉取的全部币（OKX 永续为准，全量进注册表，启用前逐币核验）；②卡片档位按 4/6/9 先来；③筛选=搜名字＋收藏；④不允许重复卡，一币一卡；⑤档位即布局切换（1分4/1分6/1分9），币数与槽位对齐；⑥配置存储用户定：本地 SQLite（服务端文件）；TM 已告知 Vercel 生产文件系统短暂、生产持久化另议。
- 当前 Task（正干到哪）（累计打回 n/2，supervisor每次打回时TM同步更新）：DEV-多标的观察盘已收工待交付；累计打回 0/2
- 执行链/Session（可选，仅真 resume 通道填，普通 subagent 可空；TM 只记录/引用，ID 由基础设施返回，不手造、不要求用户复制；返工确认是否原链；senior 升级开新链后更新）：builder opencode直调同链返工2轮；reviewer/QA 本窗口；supervisor opencode直调
- 未闭环评审意见（code-reviewer/qa 留的还没改的）：无（P1-blocking×2已闭环终核PASS；P1-非blocking备份演练/market-service动态化＋P2记后续）
- docs 落盘清单：docs/pm/PRODUCT_PLAN.md（V0.2）、docs/review/RESEARCH_REVIEW.md（第2轮PASS）、docs/review/CODE_REVIEW.md（含终核PASS＋P1第二轮PASS＋核验闭环终核PASS）、docs/qa/BUGS.md（QA PASS 0新BUG×4轮）、docs/qa/SQLITE_BACKUP_RESTORE.md、docs/model/两账本（示例行已删＋真实行已落）、本HANDOFF
- 下一步（Next Single Action）：用户定夺commit＋push（main）触发Vercel部署；部署后复验 /api/config、/api/assets、首页观察盘
- 人要拍什么板（列出来问，不问不许开工）：commit＋push（main）是否执行（迁移整理＋Phase1＋DEV 三批改动一次推，见 git status）
- 用户新意图（2026-09-18 12:40，Phase1 规划输入）：①交易所式标的列表（筛选/切换）；②首页卡片可自定义固定数量；③每卡可切换单个标的。用户确认「就这个核心功能」。范围冲突：现冻结约束仅 PEPE/DOGE/ETHFI＋BTC，用户提到关注 6 个标的→涉加币，TM 暂按 CHANGE C（产品范围变更）候选记，待 Planner 方案＋Human Gate 定。
- 用户澄清（12:45）：固定数量不锁定为 6，可配（4/6/9 任意）。
- Planner 首派未落盘（codex 只读沙箱拒写，现状核实完成，P0 5 条已带回）；已重派（workspace-write）出 PRODUCT_PLAN 初版。
- CHANGE_REQUEST 候选：C（待定，以 Planner 方案为准）
- permission_request（可选：原文/决策/回执一句，首版可先记自然语言一句）：迁移整理全程自动已授权；commit/push 按次单独确认（本次未提交）
- 收尾记一笔（neat-freak：文档对齐了没、临时文件清了没、未决列完没；neat 派完后 TM 补记，若已落盘则追加修订行）：归位表已落盘；备份 3（AGENTS/分工表/HANDOFF 旧版同级保留）；账本示例行已删（TASK/DISPATCH 各 1 行）；未决：母版分工表无 db-admin 行（备份保留）、PROJECT_PROGRESS.md 仍旧口径。
- 修订行（2026-09-18 严查）：母版演进已同步——AGENTS 9+1→9+1＋1 专项重铺（合版另存）、db-admin 角色卡已铺（分工表软链自动跟上）、task-manager 卡已换新；合并校验：项目旧规矩逐字节无损（仅空行差）。

## 恢复读盘（全体系唯一顺序，别乱）

1. AGENTS；2. 角色卡；3. 根 `USER_MODEL_OVERRIDE.md`；4. 本 HANDOFF；5. 根 `经验一句话.md`；6. 任务目标放最后。
冲突才扩大读。
