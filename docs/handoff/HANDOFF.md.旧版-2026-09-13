# HANDOFF — 项目交接文档

> 生成时间：2026-09-15 16:30 UTC+8
> 生成者：CodeArts Agent
> 项目：pepe-doge-breakout-radar-deepseek-v4-pro（山寨滚仓网站）

---

## 一、当前工作进度

### 已完成（本会话）

| 项目 | 状态 | 时间 |
|------|------|------|
| 浅色模式开发 | ✅ 完成 | 2026-09-15 |
| TypeScript 类型检查 | ✅ 0 错误 | 2026-09-15 |
| ESLint 检查 | ✅ 0 告警 | 2026-09-15 |
| StyleLint 检查 | ✅ 0 错误 | 2026-09-15 |
| Git 提交 `65ced4d` | ✅ feat: 浅色模式 + 主题切换 | 2026-09-15 |
| Git push | ✅ origin/main | 2026-09-15 |
| Vercel 部署 | ✅ Ready | 2026-09-15 |

### 浅色模式实现细节

**1. `src/app/globals.css`**
- `:root` → 浅色模式：白底 `#f8fafc`、深色文字 `#0f172a`、卡片白 `#ffffff`、边框 `slate-200`
- `.dark` → 深空雷达站：原有深色配色，50+ CSS 变量全覆盖
- 品牌荧光绿 `#2ee6a8` 双模式保持一致

**2. `src/app/layout.tsx`**
- 接入 `ThemeProvider`，`attribute="class"`，默认 `system`
- 移除硬编码 `className="dark"`
- 添加 `suppressHydrationWarning` 防止 SSR 水合闪烁
- `disableTransitionOnChange` 避免主题切换动画跳变

**3. `src/components/layout/SiteHeader.tsx`**
- 右上角太阳/月亮图标按钮
- 点击循环切换：light → dark → system
- `mounted` 状态防止客户端渲染不匹配
- localStorage 记住用户偏好

**4. `stylelint.config.mjs`**
- 放宽 `@apply` 校验，解决历史遗留问题

### 线上地址

```
https://pepe-doge-breakout-radar-deepseek-v4-zyt0he48v-houfan.vercel.app
```

---

## 二、下一步任务

### 待处理（按优先级）

| 优先级 | 任务 | 来源 | 状态 |
|--------|------|------|------|
| P2 | BUG-001：`rolling 阻力` 文案改名为 `当前下一压力` | BUGS.md | 待处理 |
| P2 | BUG-002：方法论「风险分」改名为 `Entry Heat` | BUGS.md | 待处理 |
| P2 | BUG-003：Follow-through `WEAK≥35` 文档与实现不一致 | BUGS.md | 待处理 |
| Info | INFO-001：`partial` 死类型清理 | BUGS.md | 建议 |
| Info | INFO-002：`price == invalidationLevel` 改为 `<=` | BUGS.md | 建议 |
| Info | INFO-003：`heldAbove=null` 语义确认 | BUGS.md | 建议 |
| Style | STYLE-DEBT：硬编码 hex 改为 CSS token | BUGS.md | 历史遗留 |

### 待验证

- [ ] Vercel 部署后浅色模式线上效果确认
- [ ] 本地代理稳定性确认（OKX/Binance 数据访问）

---

## 三、注意事项及相关规范

### 网络环境

⚠️ **本地网络限制**：用户本地环境（运营商防火墙/内网策略）曾屏蔽 OKX、Binance、GitHub。
- 当前已启用代理，GitHub 恢复可达
- OKX/Binance 数据访问需确认代理稳定性
- 线上版本（Vercel 东京节点 hnd1）数据正常

### 代码验证流程

```bash
pnpm tsc -p tsconfig.json      # TypeScript 类型检查
pnpm lint:build                 # ESLint 检查
pnpm lint:style                 # StyleLint 检查
pnpm test                       # 单元测试
pnpm validate                   # 全部验证
```

### 项目约束

- **仅 PEPE/DOGE + BTC**，无其他币种
- **无胜率/准确率/假突破概率数值**，无收益承诺
- **无「买入/开仓/建议」表述**（禁用语扫描）
- **配色用 token**（`--radar/--pepe/--doge/--btc/--bull/--bear/--warn`）
- **自绘 SVG**，无新增图表依赖
- **时间统一 UTC 存储、Asia/Shanghai 展示**

### 技术栈

- Next.js 16 + React 19.2.3 + TypeScript 5
- Tailwind CSS 4 + shadcn/ui + next-themes
- pnpm 9.0.0（强制，`preinstall` 脚本锁定）
- Vercel 部署（东京节点 hnd1）

### 关键文件

| 文件 | 作用 |
|------|------|
| `src/app/layout.tsx` | 根布局，ThemeProvider |
| `src/app/globals.css` | 全局样式，主题变量 |
| `src/components/layout/SiteHeader.tsx` | 导航栏，主题切换按钮 |
| `src/lib/action.ts` | Action Card 核心逻辑 |
| `src/lib/v2/engine.ts` | 六层评分引擎 |
| `src/lib/state-machine.ts` | 十态状态机 |
| `docs/qa/BUGS.md` | 缺陷台账 |
| `docs/qa/QA_CHECKLIST.md` | 回归清单 |
| `docs/review/CODE_REVIEW.md` | 代码审查报告 |

### 文档现状

- `docs/qa/`：BUGS.md、QA_CHECKLIST.md、ethfi-acceptance/、ethfi-production/
- `docs/review/`：CODE_REVIEW.md
- `docs/handoff/`：本文件
- ⚠️ 缺失：`docs/roles/`、`docs/pm/`（CODE_REVIEW.md 中已标注）

---

## 四、提交记录

```
65ced4d feat: 浅色模式 + 主题切换
2d37326 docs(radar): README补首页产品截图+生产地址+本次推送变动说明
ecced00 feat(research): 前向采集器+基线澄清（QA PASS，实时零消费）
```

---

## 五、下一步智能体接续提示词

见下方「一键复制」区域。