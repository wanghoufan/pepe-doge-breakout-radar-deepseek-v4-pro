# 项目上下文

## 项目概述

**PEPE/DOGE 突破雷达**——一个基于历史量化研究的行情观测型 Web 应用。它把研究包里 21 个历史「突破/失败」样本的量化特征，变成一套**确定性、可解释、可回放**的实时观测雷达：用 EMA20/50/100、ATR 压缩、量比、相对 BTC 强度、资金费率等指标，把币种状态归入六态状态机（观望 / 蓄势 / 临界 / 突破确认 / 等待回踩 / 失效），并对「机会分」与「过热/失效风险分」分别打分。

**关键边界（用户长期约束，勿违反）：**
- 仅覆盖 PEPE 与 DOGE 两个标的 + BTC 作为环境参照，不扩展到其它币种。
- **不输出胜率、准确率、假突破概率或任何收益承诺**；只输出「机会分 / 风险分 / 满足/缺失条件 / 关键价位 / 证据来源与新鲜度」。
- 历史维度**不设普通行情对照窗口，也不设失败样本对照**，只展示 21 个波段样本本身；缺失失败样本是已知缺口，如实标注、不补造。
- 这是独立产品，与「滚仓计算器」无关，禁止读取/合并其代码。

## 技术栈

- Framework: Next.js 16 (App Router, `src/` 目录) + 自定义 server 入口 `src/server.ts`
- React 19 / TypeScript 5 / Tailwind CSS 4 / shadcn/ui (Radix) / recharts（预装，本项目图表用自绘 SVG）
- 包管理器：**仅 pnpm**，禁止 npm / yarn

## 目录结构（本项目关键部分）

```
src/
  lib/
    types.ts          # 核心数据模型（含 EvidenceValue 值与来源/新鲜度、AssetSignal、六态 StateCode）
    config.ts         # 权重、候选阈值、六态元信息 STATE_META、标的 ASSETS（集中管理，勿散落）
    indicators.ts     # 指标纯函数：EMA/ATR/量比/相对强度/maxDrawdown（与历史分析脚本逐行等价，勿改算法）
    event-analysis.ts # 历史事件定义 EVENT_DEFS、CAMPAIGNS 分组、computeEventMetrics（复刻研究脚本）
    analysis.ts       # 实时引擎：analyzeAsset/analyzeBtcEnv/computeFeatures/评分/硬否决
    state-machine.ts  # 六态状态机 determineState(state, vars)
    similarity.ts     # 特征向量 + z-score + 余弦相似度（A 类证据特征）
    data-store.ts     # 载入 src/data 快照：getHistoricalEvents/getHistoricalEventById/getWindowData/getSnapshotCandles/getSnapshotFunding
    market-client.ts  # 第三方数据代理：OKX/Binance，超时/内存缓存/限频/去重/错误分类
    market-service.ts # getMarketOverview()：撮合环境+币种信号，网络不可用时返回 status='unavailable'
    format.ts         # 数值/时间格式化（时间统一 UTC 存储、Asia/Shanghai 展示）
  app/
    page.tsx            # 总览：实时雷达 + 历史样本
    asset/[coin]/page.tsx     # PEPE/DOGE 详情
    history/page.tsx          # 历史样本矿场
    history/[id]/page.tsx     # 历史事件详情（指标+窗口图+原始截图）
    similarity/page.tsx       # 相似性（历史特征空间 + 当前像谁）
    methodology/page.tsx      # 方法论 + 阈值回放实验
    api/                    # REST 接口（见下）
  components/market/   # CandleChart(自绘SVG)/StateBadge/ScoreRing/SignalCard/LiveRadar/HistoryGrid/AssetDetail/SimilarityView
  components/layout/   # SiteHeader/SiteFooter
  data/                # 研究快照 JSON：event-metrics.json + candles/*.json + funding/*.json（勿改动原始数值）
public/screenshots/    # 21 张原始截图，命名 P01..P11 / D01..D10
```

## 关键入口 / 接口清单

页面路由：`/`、`/asset/pepe`、`/asset/doge`、`/history`、`/history/:id`、`/similarity`、`/methodology`

REST 接口（`app/api/**/route.ts`，前端统一相对路径调用 `/api/...`）：

| 接口 | 说明 | 降级行为 |
|---|---|---|
| `GET /api/market/overview` | 环境+双币种信号 | 无网返回 `{ok,status:'unavailable'}` + summary |
| `GET /api/market/candles?instId=&bar=` | K 线 | 无网回退到研究快照 `{source:'snapshot',degraded:true}` |
| `GET /api/market/funding?coin=` | 资金费率 | 无网回退快照 |
| `GET /api/history` | 21 事件列表 | 纯本地，恒可用 |
| `GET /api/history/:id` | 事件详情+窗口数据 | 纯本地 |
| `GET /api/history/:id/window` | 启动前快照（阈值回放用） | 纯本地 |
| `GET /api/similarity` | 历史特征矩阵+散点 | 纯本地 |
| `GET /api/similarity/current` | 当前特征 vs 历史相似 | 无网返回 `status:'unavailable'` |

## 运行与预览

- 预览：`preview_enable = "enabled"`，对外只暴露 5000，`.preview` 写 `expose_port = 5000`，已被 `.gitignore` 忽略。
- 开发运行：`bash scripts/dev.sh`（`tsx watch src/server.ts`，监听 `process.env.PORT||5000`）。
- 数据请求走服务端 `market-client`（`src/server.ts` 内自定义 server），前端不直接访问第三方接口，规避 CORS 与密钥暴露。
- 环境无外网（OKX/Binance 被沙箱 DNS 墙为 169.254.0.2），实时数据恒 `unavailable`/`snapshot` 降级——历史模式仍完整可用；这是预期行为，不要反复确认或强行联网。

## 用户偏好与长期约束

- 全部命中条件、评分、状态判定**必须可解释**：给「值 + 证据来源 + 时间戳 + 新鲜度(ok/stale/missing)」，不画「魔法图」。
- 时间戳一律 UTC 存储、页面按 Asia/Shanghai 显示。
- 不谈收益/准确性/胜率；缺失的失败样本与普通行情对照窗口，在 UI 与方法论里如实标注为「已知缺口」。

## 常见问题和预防

- `pnpm test` 跑纯函数单测 + 21 事件回归：`node --import tsx --test src/lib/*.test.ts src/lib/v2/*.test.ts`；`event-analysis.test.ts` 会对一行`事件`是否与 `event-metrics.json` 完全一致。
- 改 `indicators.ts` 的算法会破坏与历史研究脚本的一致性，必须回归测试通过后再交付。
- `globals.css` 里自定义 Tailwind 主题色：`--radar`(荧光青)、`--pepe`、`--doge`、`--btc`、`--bull`、`--bear`、`--warn`；新增组件配色用这些 token，不要写死 hex。
- 图表为自绘 SVG（`CandleChart.tsx`），不要引入额外图表依赖。