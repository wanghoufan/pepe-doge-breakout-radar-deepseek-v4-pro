# PEPE/DOGE/ETHFI 突破雷达

基于历史量化研究的行情观测型 Web 应用（V2）。它把研究包里的量化特征，转成一套**严格时点对齐、无未来数据污染、可实时、可回测、可区分成功/失败突破**的观测雷达：持续追踪 PEPE 与 DOGE 的蓄势、临界、突破、跟随与失效状态，用六层独立评分（环境闸门 / Setup / Trigger / Follow-through / Risk / Hard Veto）+ 十态状态机代替模糊判断。

> 本项目**不构成任何投资建议**，**不输出面向交易决策的胜率、准确率、假突破概率或收益承诺**。回测指标仅作研究诚实性证据。

---

## 它能做什么

- **实时雷达**：对 PEPE / DOGE 各自输出分层信号——环境闸门（ALLOW/CAUTION/BLOCK）→ Setup 蓄势分 → Trigger 突破分 → Follow-through 跟随分 → Risk 风险分 → Hard Veto 硬否决，再归入十态状态机（市场禁止 / 无蓄势 / 蓄势形成中 / 临界突破 / 突破确认 / 等待跟随 / 健康突破 / 回踩确认 / 突破失败 / 结构失效）。
- **无未来数据污染**：突破用 Rolling Breakout（`rollingHigh(t) = MAX(high[t-42..t-1])`，仅已收盘 4H K 线 `close > rollingHigh` 成立）；Setup 只用突破前数据，Follow-through 只用突破后数据；MFE/MAE 从 breakoutClose 起算且仅作事后标签。
- **证据可解释**：每个状态、每层评分都给出「数值 + 证据来源 + 时间戳 + 新鲜度」，缺数据显式标 `WAITING/PENDING/DATA_UNAVAILABLE`，绝不冒充 0 分。
- **历史事件**：21 个研究波段（PEPE 11 + DOGE 10）按 V2 重算，每个都能查看突破位/距离、MFE/MAE、相对 BTC 强度、窗口 K 线与原始截图。
- **成败样本与回测**：冻结样本基线为 Raw 层 290（PEPE 140 + DOGE 150，仅作膨胀证据、禁当样本）/ Episode 层 116 Independent Episodes（成功 41 + 失败 75，冻结标签 `72H MFE ≥ 10% AND MAE ≥ −8%`）/ Normal 层 768 窗口（760 可评：PEPE 379 / DOGE 381）+ 异常窗口独立建事件，walk-forward 样本外回测，如实呈现「朴素突破信号≈无超额」的结论。旧「217（成功 75 / 失败 142）」为旧 raw-cooldown 口径、已作废，禁作样本基线（以 `PRE_ALERT_DATA_PROTOCOL_V1.md` §4 冻结口径为准）。
- **相似性引擎**：用「ATR 收缩比 / 量能收缩比 / 启动前收益 / 启动前 ATR / 启动前费率」五维（均突破前、无未来信息）特征向量化，回答「当前最像历史上的哪一波」。
- **优雅降级**：`overview` 不可用时标 `unavailable`；`candles` / `funding` 失败返回 503 + 真实诊断（绝不拿历史快照冒充实时）；历史模式恒完整可用。

## 页面

| 路由 | 说明 |
|---|---|
| `/` | 总览：实时雷达 + 历史样本 |
| `/asset/pepe`、`/asset/doge` | 单币详情 |
| `/history` | 历史样本矿场（可筛选币种/波段周期） |
| `/history/:id` | 事件详情：分层指标 + MFE/MAE + 窗口图 + 原始截图 |
| `/similarity` | 相似性：历史特征空间 + 当前像谁 |
| `/methodology` | 方法论：十态状态机 + 分层评分 + 证据规则 + 回测 |

## 技术栈

Next.js 16 (App Router) · React 19 · TypeScript 5 · Tailwind CSS 4 · shadcn/ui · 自绘 SVG K 线图 · 服务端数据代理。

## 本地运行

```bash
pnpm install
bash scripts/dev.sh          # 开发模式（tsx watch src/server.ts）
```

运行测试（73 项单测 + 21 事件回归）：

```bash
pnpm test
```

## 目录速览

```
src/lib/          十态状态机、分层引擎（v2/engine.ts）、Rolling Breakout、MFE/MAE、相对强度、历史事件、数据代理、快照载入
src/app/          页面路由 + REST 接口（/api/*）
src/components/   业务组件（自绘 K 线图、十态状态徽章、分层信号卡、雷达卡等）
src/data/         研究快照 JSON（21 事件指标 + 3 币种 4H K 线 + 资金费率）
public/screenshots/  21 张原始截图（P01..P11 / D01..D10）
scripts/recompute-v2.ts  离线重算 21 事件 + 全量扫描 + walk-forward 回测
```

## 数据来源

- 历史快照：研究包内 `event_metrics.csv`（21 事件）、OKX 4H K 线、Binance 资金费率。
- 实时：OKX（K 线 / 指数价）与 Binance（资金费率），由服务端 `src/lib/market-client.ts` 代理：超时、内存缓存、限频去重、错误分类。
- 时间：UTC 存储，页面按 Asia/Shanghai 显示。

## 已知缺口（如实标注，不补造）

- 衍生品指标不完整：Funding 已接入，Open Interest / Liquidation 尚未接入，Risk 层与 `LIQUIDITY_VETO` 暂缺这些维度。
- 样本量有限：仅两个标的、约 883 天 4H 数据、冻结基线 290 raw / 116 episodes（41 成功 / 75 失败）/ 768 normal（760 可评），walk-forward 各 fold 样本稀疏，Precision/Recall 波动大。旧「217 个突破」为旧 raw-cooldown 口径、已作废。
- MFE/MAE 标签阈值（MFE≥10% / MAE≥-8%）为单组取值，尚未做参数敏感性分析。
- 沙箱/部分部署环境无法访问 OKX / Binance 外网时，实时雷达显示「实时数据不可用」，历史维度仍完整可用。

## 免责声明

本项目是行情观测与研究方法展示工具，所有输出均为基于历史数据与公开指标的量化描述，不含任何形式的风险收益承诺。
