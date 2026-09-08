# 项目上下文

## 项目概述

**PEPE/DOGE 突破雷达**——一个基于历史量化研究的行情观测型 Web 应用（V2）。它把研究包里的量化特征，转成一套**严格时点对齐、无未来数据污染、可实时、可回测、可区分成功/失败突破**的识别雷达：用 Rolling Breakout（42 根 4H 回看）+ EMA/ATR/量比/相对 BTC 强度/资金费率，把币种状态归入十态状态机，并拆成六层独立评分（环境闸门 → Setup → Trigger → Follow-through → Risk → Hard Veto）。

**关键边界（用户长期约束，勿违反）：**
- 仅覆盖 PEPE 与 DOGE 两个标的 + BTC 作为环境参照，不扩展到其它币种。
- **不输出面向交易决策的胜率、准确率、假突破概率或任何收益承诺**。回测指标（Precision/Recall/FPR/Success Rate/MFE/MAE）仅作为「样本外真实表现」的研究诚实性证据在方法论页呈现，并明确标注「不构成收益承诺、不构成交易建议」。
- 历史维度已纳入失败样本与普通行情对照窗口（全量突破扫描 217 个：成功 75 / 失败 142；普通窗口 PEPE 5 / DOGE 7），用于 walk-forward 样本外检验，不再只展示人工挑选的成功案例。
- 这是独立产品，与「滚仓计算器」无关，禁止读取/合并其代码。

## 技术栈

- Framework: Next.js 16 (App Router, `src/` 目录) + 自定义 server 入口 `src/server.ts`
- React 19 / TypeScript 5 / Tailwind CSS 4 / shadcn/ui (Radix) / recharts（预装，本项目图表用自绘 SVG）
- 包管理器：**仅 pnpm**，禁止 npm / yarn

## 目录结构（本项目关键部分）

```
src/
  lib/
    types.ts          # V2 核心数据模型：十态 StateCode、LayeredScore、BreakoutInfo、EnvironmentState、FeatureVectorV2、AssetSignal
    config.ts         # 十态 STATE_META、V2 阈值(DEFAULT_V2_THRESHOLDS,分位优先)/权重(DEFAULT_V2_WEIGHTS)、ASSETS（集中管理，勿散落）
    time.ts           # P0-1 时区统一：UTC 毫秒、parseCSTDate/parseISO、floorTo4H、收盘判定
    breakout.ts       # P0-2 Rolling Breakout：getRollingHigh/detectBreakoutAt/detectBreakout/detectAllBreakouts（实时/历史/回测共用）
    mfe-mae.ts        # P0-4 MFE/MAE（24/48/72h/7D，相对 breakoutClose，窗口不含突破 K 线）
    relative-strength.ts # ratio-based 相对 BTC 强度（coin/btc 合成比值）
    statistics.ts     # percentile/percentileRank（分位阈值）
    indicators.ts     # 指标纯函数：EMA/ATR/量比/maxDrawdown（与历史分析脚本逐行等价，勿改算法）
    event-analysis.ts # 历史事件 EVENT_DEFS（ISO UTC）、CAMPAIGNS、computeEventMetrics（Rolling detector + MFE/MAE）
    analysis.ts       # 再导出 V2 引擎 analyzeAssetV2（废弃单一机会分）
    state-machine.ts  # 十态状态机 determineStateV2(input)
    similarity.ts     # 特征向量 + z-score + 余弦相似度（仅突破前字段，无未来信息）
    data-store.ts     # 载入 src/data 快照：getHistoricalEvents/getHistoricalEventById/getSnapshotCandles/getSnapshotFunding/getEventCandles
    market-client.ts  # 第三方数据代理：OKX/Binance，超时/内存缓存/限频/去重/错误分类
    market-service.ts # getMarketOverview()：analyzeAssetV2 + ratio 相对强度互馈，网络不可用时 status='unavailable'
    format.ts         # 数值/时间格式化（时间统一 UTC 存储、Asia/Shanghai 展示）
    v2/
      engine.ts       # analyzeAssetV2 + 六层评分（Environment/Setup/Trigger/Follow-through/Risk/Hard Veto）
      samples.ts      # scanBreakoutSamples + 成功/失败标签 + 普通窗口
      backtest.ts     # walkForwardBacktest + computeMetrics + CANDIDATE_RULES
  app/
    page.tsx            # 总览：实时雷达 + 历史样本
    asset/[coin]/page.tsx     # PEPE/DOGE 详情
    history/page.tsx          # 历史样本矿场
    history/[id]/page.tsx     # 历史事件详情（指标+MFE/MAE+窗口图+原始截图）
    similarity/page.tsx       # 相似性（历史特征空间 + 当前像谁）
    methodology/page.tsx      # 方法论：十态状态机 + 分层评分 + 证据规则
    api/                    # REST 接口（见下）
  components/market/   # CandleChart(自绘SVG)/StateBadge(10态)/ScoreRing/SignalCard(分层)/LiveRadar/HistoryGrid/AssetDetail/SimilarityView
  components/layout/   # SiteHeader/SiteFooter
  data/                # 研究快照 JSON：event-metrics.json + candles/*.json + funding/*.json（V2 已重算 21 事件）
public/screenshots/    # 21 张原始截图，命名 P01..P11 / D01..D10
```

## 关键入口 / 接口清单

页面路由：`/`、`/asset/pepe`、`/asset/doge`、`/history`、`/history/:id`、`/similarity`、`/methodology`

REST 接口（`app/api/**/route.ts`，前端统一相对路径调用 `/api/...`）：

| 接口 | 说明 | 降级行为 |
|---|---|---|
| `GET /api/market/overview` | 环境闸门 + 双币种分层信号 | 无网返回 `{ok,status:'unavailable'}` + summary |
| `GET /api/market/candles?instId=&bar=` | K 线 | 无网回退到研究快照 `{source:'snapshot',degraded:true}` |
| `GET /api/market/funding?coin=` | 资金费率 | 无网回退快照 |
| `GET /api/history` | 21 事件列表 | 纯本地，恒可用 |
| `GET /api/history/:id` | 事件详情+窗口数据 | 纯本地 |
| `GET /api/similarity` | 历史特征矩阵+散点 | 纯本地 |
| `GET /api/similarity/current` | 当前特征 vs 历史相似 | 无网返回 `status:'unavailable'` |
| `GET /api/market/health` | 连通性诊断：逐源探测 OKX/Binance 状态码/错误/耗时 | 纯本地诊断 |

## 运行与预览

- 预览：`preview_enable = "enabled"`，对外只暴露 5000，`.preview` 写 `expose_port = 5000`，已被 `.gitignore` 忽略。
- 开发运行：`bash scripts/dev.sh`（`tsx watch src/server.ts`，监听 `process.env.PORT||5000`）。
- 数据请求走服务端 `market-client`（`src/server.ts` 内自定义 server），前端不直接访问第三方接口，规避 CORS 与密钥暴露。
- 环境无外网（OKX/Binance 被沙箱 DNS 墙为 169.254.0.2），实时数据恒 `unavailable`/`snapshot` 降级——历史模式仍完整可用；这是预期行为，不要反复确认或强行联网。
- **生产部署**：Vercel 项目 `pepe-doge-breakout-radar`（地域 `hnd1` 东京）已绑定 GitHub repo `wanghoufan/pepe-doge-breakout-radar-deepseek-v4-pro`，push 到 `main` 自动触发生产部署；生产地址 https://pepe-doge-breakout-radar.vercel.app（`vercel.json` 指定 `framework: nextjs`、`installCommand: pnpm install --no-frozen-lockfile`、`buildCommand: pnpm next build`）。

## 用户偏好与长期约束

- 全部命中条件、评分、状态判定**必须可解释**：给「值 + 证据来源 + 时间戳 + 新鲜度(ok/stale/missing)」，不画「魔法图」。
- 时间戳一律 UTC 存储、页面按 Asia/Shanghai 显示。
- 不谈面向交易决策的收益/准确性/胜率；回测指标仅作研究诚实性证据、不构成收益承诺；失败样本与普通行情对照窗口已纳入（V2），在 UI 与方法论里如实呈现。

## 常见问题和预防

- `pnpm test` 跑 73 项单测 + 21 事件回归：`node --import tsx --test src/lib/*.test.ts src/lib/v2/*.test.ts`；`event-analysis.test.ts` 校验每个事件是否与 `event-metrics.json` 完全一致；`v2.test.ts` 覆盖 Rolling Breakout / 无未来数据 / 时区 / walk-forward / Hard Veto 等 10 项核心约束。
- 改 `indicators.ts` 的算法会破坏与历史研究脚本的一致性，必须回归测试通过后再交付。
- `globals.css` 里自定义 Tailwind 主题色：`--radar`(荧光青)、`--pepe`、`--doge`、`--btc`、`--bull`、`--bear`、`--warn`；新增组件配色用这些 token，不要写死 hex。
- 图表为自绘 SVG（`CandleChart.tsx`），不要引入额外图表依赖。