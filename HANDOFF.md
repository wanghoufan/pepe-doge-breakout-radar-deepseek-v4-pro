# 开发交接文档（Handoff）

> 目的：供下一个智能体快速恢复上下文并继续迭代，避免重复探索。
> 生成时间：2026-09-07 ｜ 仓库：`wanghoufan/pepe-doge-breakout-radar-deepseek-v4-pro`（公开）｜ 分支：`main`

---

## 一、当前工作进展

### 1. 项目定位

**PEPE/DOGE 突破雷达** —— 基于 21 个历史「突破」波段样本量化特征的行情观测型 Web 应用。

把研究包里的量化特征转成一套**确定性、可解释、可回放**的实时观测雷达：用 EMA20/50/100、ATR 压缩、量比、相对 BTC 强度、资金费率等指标，把币种状态归入六态状态机（观望 → 蓄势 → 临界 → 突破确认 → 等待回踩 → 失效），并对「机会分」与「过热/失效风险分」分别打分。

> 不构成投资建议；不输出胜率、准确率、假突破概率或收益承诺。

### 2. 已完成清单（全部落地并可运行）

| 模块 | 内容 | 状态 |
|---|---|---|
| 项目初始化 | `coze init . --template nextjs`，`sub_id = ad788271`，`project_type = web` | ✅ |
| 页面 | `/`、`/asset/pepe`、`/asset/doge`、`/history`、`/history/:id`、`/similarity`、`/methodology`（6 页） | ✅ |
| REST 接口 | `/api/market/overview`、`/api/market/candles`、`/api/market/funding`、`/api/history`、`/api/history/:id`、`/api/history/:id/window`、`/api/similarity`、`/api/similarity/current`（8 个） | ✅ |
| 核心库 | `types/indicators/config/event-analysis/analysis/state-machine/similarity/data-store/market-client/market-service/format` | ✅ |
| 业务组件 | `CandleChart`（自绘 SVG）、`StateBadge`、`ScoreRing`、`SignalCard`、`LiveRadar`、`HistoryGrid`、`AssetDetail`、`SimilarityView` + `SiteHeader/SiteFooter` | ✅ |
| 数据资产 | 6 个快照 JSON（`event-metrics` + 3 币种 4H K 线 + 2 资金费率）；21 张截图重命名为 `P01..P11 / D01..D10` | ✅ |
| 测试 | 3 个测试文件（`indicators/event-analysis/state-machine`），**19 个测试全通过**（含 21 事件回归） | ✅ |
| 验收 | `test_run` 全绿（lint + ts-check + probe + 冒烟接口） | ✅ |
| 部署配置 | `general-deploy` 已配置：`[deploy]` build=`build.sh`、run=`start.sh`、`entrypoint = dist/server.js`、`kind=service / flavor=web` | ✅ |
| 生产构建 | `next build` + `tsup` 已本地验证通过；`COZE_PROJECT_ENV=PROD node dist/server.js` 下 8 个 API 均返回 200 JSON | ✅ |
| 文档 | `README.md`、`AGENTS.md`、`DESIGN.md` 已写 | ✅ |

### 3. 当前提交与部署状态

- 本地 `main` 最新提交：`3d9e048 fix(market): OKX 实时行情接通 + 独立降级 + 真实诊断`
- GitHub 远程 `main` 已完全同步，HEAD 即 `3d9e048`
- **线上已恢复**：Vercel 项目 `pepe-doge-breakout-radar`（地域 `hnd1` 东京）已绑定 GitHub repo 并完成生产部署，关闭了 SSO 部署保护，公开可访问：
  - **生产地址**：https://pepe-doge-breakout-radar.vercel.app
  - **诊断接口**：https://pepe-doge-breakout-radar.vercel.app/api/market/health
  - `/api/market/health` 实际返回 `summary:{okx:ok, binance:ok, funding:ok}`，`env:{runtime:vercel:production, region:hnd1}`，逐源 URL/状态码/errorKind/耗时全绿。
- PEPE / DOGE / BTC 三币种 `GET /api/market/overview` 均返回 `status:"live"`，含真实 OKX 最新价、ts、最后已收盘 4H K 线时间与盘中未收盘价（不参与突破判定）。

---

## 二、下一步任务

### 1. 立即待办（已全部完成）

- ~~在扣子平台重新部署~~：已在 Vercel 通过 GitHub 部署生产并验证三币种实时数据，地址为 https://pepe-doge-breakout-radar.vercel.app。旧 coze.site 站点 `qy9v9h8vh3.coze.site`（旧提交 `da7b840`）的失效不再影响，新产品主推 Vercel 部署。
- 部署后验证（已过）：
  - 6 个页面能正常渲染；8 个 `/api/*` 返回 200 JSON。
  - `/api/market/health` 逐源诊断全绿（OKX 多个域名 + Binance 资金费率）。
  - PEPE / DOGE / BTC 实时价格、K 线、资金费率均为 `status:"live"`，带真实 ts 与最后已收盘 4H K 线时间。
  - 盘中未收盘 K 线单列标注「不构成突破确认」，突破判定仅基于已收盘 K 线。

### 2. 恢复开发的标准操作

```bash
pnpm install                 # 若 node_modules 缺失
pnpm test                    # 19 个测试基线（改代码前先确认通过）
bash scripts/dev.sh          # 开发模式，预览暴露 5000（tsx watch src/server.ts）
```

- 交付前统一用 `test_run` 验收（静态检查 + 服务探活 + 业务接口冒烟）。
- 环境无外网（OKX/Binance 被沙箱 DNS 墙为 169.254.0.2），实时数据恒为 `unavailable`/`snapshot` 降级，**不要反复确认或强行联网**。

### 3. 产品迭代方向（在约束边界内，需用户明确后才动）

- 当前阶段「已明确不做」：失败突破样本、普通行情对照窗口、胜率/准确率/假突破概率/收益承诺。这些是**已知缺口**，后续是否补由用户明确授意，勿擅自添加。
- 其余新需求由用户提出后，在 `AGENTS.md` 的约束下迭代。

---

## 三、注意事项与规矩

### 1. 产品硬约束（不可违反）

- **仅覆盖 PEPE、DOGE 两个标的 + BTC 作为环境参照**，不扩展到其它币种。
- **不输出胜率、准确率、假突破概率或任何收益承诺**；只输出「机会分 / 风险分 / 满足与缺失条件 / 关键价位 / 证据来源与新鲜度」。
- 历史维度**不设普通行情对照窗口、不设失败样本对照**；缺失的失败样本是已知缺口，如实标注、不补造。
- 这是**独立产品**，与「滚仓计算器」无关，禁止读取/修改/复制/合并其代码。

### 2. 工程/技术规范

- **包管理器仅 `pnpm`**，禁止 npm / yarn；Node 运行时 `nodejs-24`（`.coze` 的 `requires`）。
- **算法不可改**：`src/lib/indicators.ts` 的 EMA/ATR/量比/相对强度算法与历史分析脚本逐行等价，改算法会破坏 21 事件回归；改动后必须 `pnpm test` 通过。
- **时间戳统一 UTC 存储、页面按 Asia/Shanghai 显示**（`src/lib/format.ts`）。
- **图表为自绘 SVG**（`CandleChart.tsx`），不引入额外图表依赖（recharts 是模板预装，未使用）。
- **配色用 token**：`globals.css` 里定义 `--radar/--pepe/--doge/--btc/--bull/--bear/--warn`，新增组件配色用这些 token，不写死 hex。
- **前端不直接访问第三方接口**：数据请求走服务端 `src/lib/market-client.ts` 代理（规避 CORS 与密钥暴露），有超时/内存缓存/限频去重/错误分类。

### 3. 平台与部署规矩

- **端口**：对外只暴露 **5000**；`9000` 是系统保留端口，任何情况不用、不 kill；端口一律从 `.preview` 读（`expose_port = 5000`），**禁止 hardcode 到代码**。
- **`sub_id`（`ad788271`）创建后不可改**；改 `name`/目录名不影响它。
- **`.coze` 是平台唯一入口**：`project_type`、`preview_enable` 不得留空；当前为单层结构 `[subprojects].path = ["."]`（根 `.coze` 兼子项目职责）。
- **部署**：`[deploy]` 已由 `general-deploy` 配好；改动构建产物、启动入口、运行时依赖、目录结构或 `.coze` 后，交付前需重新确认部署配置（不能因看到已有 `[deploy]` 就跳过）。
- **数据文件勿改原始数值**：`src/data/*.json`（21 事件指标、3 币种 K 线、资金费率快照）是研究快照，勿改动；`public/screenshots/*.png` 是原始截图。

### 4. 交付规矩

- 交付前逐项核对：`.coze` 合法、`sub_id`/`project_type`/`preview_enable` 正确、`[subprojects].path` 一致、运行环境已配置、预览可跑、`[deploy]` 已确认、`AGENTS.md` 已同步、`test_run` 已过。
- 有实质改动时同步更新 `AGENTS.md`；用户明确要求长期记住的偏好/约束沉淀到 `AGENTS.md`。

---

## 附：关键文件速查

- 核心数据模型：`src/lib/types.ts`
- 权重/阈值/六态元信息/标的：`src/lib/config.ts`（集中管理，勿散落）
- 指标纯函数：`src/lib/indicators.ts`（勿改算法）
- 历史事件定义与复刻：`src/lib/event-analysis.ts`
- 实时引擎/评分/硬否决：`src/lib/analysis.ts`
- 六态状态机：`src/lib/state-machine.ts`
- 相似度（特征向量 + z-score + 余弦）：`src/lib/similarity.ts`
- 快照载入：`src/lib/data-store.ts`
- 第三方数据代理：`src/lib/market-client.ts`
- 撮合服务：`src/lib/market-service.ts`
- 自定义 server 入口：`src/server.ts`
- 部署脚本：`scripts/build.sh` / `scripts/start.sh` / `scripts/dev.sh` / `scripts/prepare.sh` / `scripts/validate.sh`
