# PEPE/DOGE Breakout Radar —— 项目完整进展（总览）

> 日期：2026-09-08 ｜ 分支：`wanghoufan/sprat` ｜ HEAD：`74b4ede`
> 验证：`pnpm test` 73/73 通过，`tsc` 零错误，`eslint` 零告警
> 用途：项目当前状态唯一入口；细节见各专项报告。

## 一、项目定位（不变）

PEPE / DOGE 双币种突破观测雷达（+BTC 作环境参照）。长期铁律：不输出胜率与开仓建议、
不扩展品类、时间戳 UTC 存储 / 北京时间展示、历史数据缺口如实标注、不造数据。

## 二、开发阶段总览（5 段，全部已提交）

| 阶段 | Commit | 内容 | 状态 |
|---|---|---|---|
| V1 全站 | `09a4883` | Next.js 全站 + 6 页面 + REST 接口 + 21 个历史事件快照 | ✅ 完成 |
| 实时接通 | `3d9e048` | OKX 实时行情 + 独立降级 + 真实诊断（不拿快照冒充） | ✅ 完成（已真机验证 OKX 在线） |
| V1→V2 | `7a22aaa` | 统一突破检测器、滚动突破、MFE/MAE、六层评分、十态状态机、38 项测试 | ✅ 完成（经取证确认为真实存在） |
| V2 整改 | `3d6ea05`（协议冻结）→ `dad7e77`（评估报告） | Episode 去重、AND 标签 + 64 格敏感性矩阵、768 个全量 normal 窗口、M1–M5 增量回测、campaign 级 walk-forward、回测协议冻结 | ✅ 方法论闭环，结论定级 PARTIAL |
| Action Card | `505ef64` → `4d7c724` → `74b4ede` | 当前行动卡 7 状态 + 术语统一 + 真机截图 + 独立审查/QA 整改 | ✅ 完成，审查条件通过 |

## 三、分模块完成度

| 模块 | 进度 | 说明 |
|---|---|---|
| 量化核心 | 100% | 历史/实时/回测共用同一检测器；Hybrid-D 规则把 290 个 raw trigger 去重为 116 个独立 episode；多窗口 outcome；walk-forward |
| Action Card | 100% | `deriveActionState()` 纯函数 + 7 状态优先级链 + 历史评分灰化 + Entry Heat 改名 + 关键价格统一命名；真机验证通过（PEPE🔴当前淘汰 / DOGE🔵回踩重点观察，与验收场景逐字一致） |
| 自动化测试 | 100% | 73/73（V2 旧 38 + 整改 16 + Action 19），`tsc`/`eslint` 全绿 |
| 报告与证据 | 100% | 取证 / 协议 / 实现 / Episode / 敏感性 / Normal 窗口 / Walk-forward / 增量模型 / Action Card / QA 清单 / 代码审查，齐备 |
| 审查整改 | 100% | 放行前置 §2.1、QA BUG-001/002/003、浮点伪影 bug、格式化统一、死代码清理，全部关闭 |
| 生产部署 | 未开始 | CODE_COMPLETE✅ / LOCAL_VALIDATED✅ / BACKTEST_VALIDATED⚠️部分 / PRODUCTION_DEPLOYED❌ / PRODUCTION_DATA_VALIDATED❌ |

## 四、核心量化结论（诚实数字，不包装）

- 冻结标签成功率 **35.3%**，约等于裸突破基线；成功率对阈值高度敏感（11%–59%），单阈值不是真理。
- **M1–M4 在样本外不优于裸突破**（ROC-AUC≈0.5）；唯一正向候选 M5（跟随管理）每 fold 仅 7–12 个信号，
  必须等新的 holdout 验证，不下结论。
- Setup 误报率高（NEAR 约 30% / BUILDING 约 41%，每币种每月约 9–10 次预警）——
  这正是 Action Card 只做"观察"、不做"信号"的原因。

## 五、存在的问题

### 🔴 需所有者裁决（阻塞生产合入）
1. **AGENTS.md 约束字面冲突（审查 §2.2）**： bust"不设普通行情对照 / 不输出胜率"原文 vs 研究层的
   768 窗口 / precision / 误报率数字。二选一：A. 约束澄清为仅限实时信号层（研究层允许口径标注的指标）；
   B. 从 UI 文案移除误报率数字。裁决前维持现状，报告指标未进任何信号 UI。
2. **3 个 Action Card 提交未 push**（`505ef64` / `4d7c724` / `74b4ede` 仅在本地）：是否 push / 合入 main 待指示。
3. **他会话文件归属待确认**：`docs/qa/BUGS.md`、`docs/qa/QA_CHECKLIST.md`、`docs/review/`、
   `V2-audit-report-2026-09-08.md` 未跟踪且非本线产出，确认归属后决定是否入仓。

### 🟡 已知缺口（长期存在，非回归）
4. 样本稀疏：116 个 episode 切 3 个 fold，每 fold test 仅 14–28 样本，结论置信区间宽。
5. M5 未经新 holdout；失败样本天然缺失（已知缺口，仅如实标注）。
6. QA INFO-002（`==` 边界）/ INFO-003（`heldAbove=null` 处理）维持现状，待产品确认语义。

### 🟢 已关闭
7. 放行前置 §2.1、全部 QA BUGS、浮点伪影 bug、截图归位（`docs/qa/`）、V1 死代码删除。

## 六、下一步（按优先级）

1. 所有者裁决 §2.2 → 同步 AGENTS.md 措辞 → push 三个提交（或按意见合入 main）。
2. 确认 `docs/qa` + `docs/review` 文件归属，统一入仓。
3. 部署上线并观察 live 数据后，做 PRODUCTION_DATA_VALIDATED（届时复验 Action Card live 路径）。
4. 新数据积累后开启 BACKTEST_PROTOCOL_V2 验证 M5（严禁污染本轮已冻结 Test）。

## 七、专项报告索引

| 报告 | 内容 |
|---|---|
| `V2_DELIVERY_FORENSICS.md` | 上一轮 V2 取证（代码位置、逐项验证） |
| `BACKTEST_PROTOCOL_V1.md` | 回测冻结协议 |
| `V2_IMPLEMENTATION_REPORT.md` | V2 整改实现与 PARTIAL 结论 |
| `EPISODE_ANALYSIS.md` | Raw 290 vs 独立 116、reset 规则比较 |
| `LABEL_SENSITIVITY.md` | 64 格敏感性矩阵、D01 四窗口全表 |
| `NORMAL_WINDOW_ANALYSIS.md` | 768 窗口、Setup 误报率 |
| `WALK_FORWARD_REPORT.md` | Campaign 级 3 folds 明细 |
| `INCREMENTAL_MODEL_REPORT.md` | B0/B1/M1–M5 比较 |
| `ACTION_CARD_REPORT.md` | Action Card 实现、回归输出、真机截图 |
| `docs/review/CODE_REVIEW.md` | 独立代码审查（含复审 §7） |
| `docs/qa/BUGS.md` / `docs/qa/QA_CHECKLIST.md` | QA 缺陷台账与长期回归清单 |
