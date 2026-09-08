import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STATE_META, DEFAULT_V2_WEIGHTS } from '@/lib/config';
import type { StateCode } from '@/lib/types';

export const metadata: Metadata = {
  title: '方法论与证据规则 · PEPE/DOGE 突破雷达',
  description: '十态状态机、分层评分（环境/蓄势/突破/跟随/风险/硬否决）与 A/B/C/D 证据分层规则说明。',
};

const STATE_ORDER: StateCode[] = [
  'MARKET_BLOCKED',
  'NO_SETUP',
  'BUILDING_SETUP',
  'NEAR_BREAKOUT',
  'BREAKOUT_CONFIRMED',
  'FOLLOW_THROUGH_PENDING',
  'HEALTHY_BREAKOUT',
  'RETESTING',
  'FAILED_BREAKOUT',
  'INVALIDATED',
];

const LAYERS = [
  {
    key: 'environment',
    title: '环境闸门（Environment Gate）',
    desc: '整体市场是否允许关注山寨币突破。输出 ALLOW / CAUTION / BLOCK，不等于机会分。',
    items: ['BTC 趋势', 'BTC 24h 硬破位', '山寨广度', 'Meme 相对 BTC'],
  },
  {
    key: 'setup',
    title: 'Setup 蓄势（0–100，仅用突破前数据）',
    desc: '币种是否正在形成突破前蓄势。严禁使用突破后量能 / 回踩 / 涨幅。',
    items: Object.entries(DEFAULT_V2_WEIGHTS.setup).map(([k, w]) => {
      const label: Record<string, string> = {
        atrCompression: 'ATR 收缩',
        volumeContraction: '量能收缩',
        distanceToResistance: '距阻力',
        baseDuration: '蓄势时长',
        higherLow: 'Higher Low',
        relativeStrength: '相对 BTC',
        emaBullishStack: 'EMA 多头',
      };
      return `${label[k] ?? k} ${w}`;
    }),
  },
  {
    key: 'trigger',
    title: 'Trigger 突破（0–100，突破发生后才有）',
    desc: '4H 收盘是否真正突破 rolling 阻力，量能 / 实体 / 相对 BTC 是否确认。未突破时显示 WAITING。',
    items: Object.entries(DEFAULT_V2_WEIGHTS.trigger).map(([k, w]) => {
      const label: Record<string, string> = {
        closeBreakout: '4H 收盘突破',
        volumeRatio: '突破量比',
        bodyStrength: '实体强度',
        closeLocation: '收盘位置',
        relBtc: '相对 BTC',
        noFakeBreakout: '无假突破',
      };
      return `${label[k] ?? k} ${w}`;
    }),
  },
  {
    key: 'followThrough',
    title: 'Follow-through 跟随（0–100，只用 breakoutTs 之后数据）',
    desc: '突破后行情是否健康：站稳突破位、24h/48h 量能持续、回踩守住、相对强度延续。不足 24h 显示 PENDING。',
    items: Object.entries(DEFAULT_V2_WEIGHTS.followThrough).map(([k, w]) => {
      const label: Record<string, string> = {
        heldAbove: '站稳突破位',
        vol24h: '24h 量能',
        vol48h: '48h 量能',
        healthyRetest: '回踩守住',
        relStrength: '相对强度',
      };
      return `${label[k] ?? k} ${w}`;
    }),
  },
  {
    key: 'risk',
    title: 'Risk 风险（0–100，越高越危险）',
    desc: '独立于机会分：追涨过远、短期涨幅、ATR 极端扩张、资金费率拥挤、BTC 环境风险。',
    items: ['追涨过远', '短期涨幅', 'ATR 极端扩张', '资金费率拥挤', 'BTC 环境风险'],
  },
];

const EVIDENCE = [
  {
    level: 'A',
    name: '一档 · 实时监测指标',
    rule: '可客观量化，用于识别蓄势 / 突破 / 跟随 / 过热 / 失效阶段（4H 收盘突破、量价配合、相对强度、波动收缩等）。',
    usage: '驱动实时状态机与分层评分。',
  },
  {
    level: 'B',
    name: '二档 · 结构化历史研究',
    rule: '21 个历史事件 + 全量历史突破扫描（成功 / 失败 / 普通窗口）与 walk-forward 回测，量化启动前形态的时间分布与真实突破后表现（MFE/MAE）。',
    usage: '提炼候选阈值与相似性参考；回测只反映样本外真实表现，不承诺收益。',
  },
  {
    level: 'C',
    name: '三档 · 截图与标注',
    rule: '原始 4H 截图对标 OKX 滚动数据，展示历史事件启动前的 K 线结构、EMA 排列与量能。',
    usage: '作为结构化的视觉解释，不形成新的量化结论。',
  },
  {
    level: 'D',
    name: '四档 · 第三方研报',
    rule: '对 meme 周期结构性总结（社区驱动、低流动性反转等），作为叙事与常识锚点。',
    usage: '仅用于补充背景理解，不进入指标计算。',
  },
];

const DISCLOSURES = [
  '本工具不是投资建议或信号系统，不构成任何买卖决策依据。',
  '突破识别的历史回测（Precision/Recall/FPR/Success Rate/MFE/MAE）只反映样本外真实表现，不构成收益承诺。',
  '所有阈值、权重均为「候选」性质，已用 walk-forward 在样本外检验，但样本量有限，仍需持续滚动更新。',
  '实时行情受数据源可用性、延迟与口径影响；数据不可用时显式标记 DATA_UNAVAILABLE，绝不冒充实时行情。',
  '资金费率跨交易所口径不同，仅作拥挤度方向性参考；Funding / Open Interest / Liquidation 等衍生品指标为增强项，不影响核心链路。',
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold">方法论与证据规则</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          雷达的判断流程：先看环境闸门，再看蓄势（Setup），4H 收盘确认突破（Trigger）后进入跟随观察（Follow-through），
          全程由风险分与硬否决独立把关，失效即退出。
        </p>
      </header>

      {/* 状态机 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">十态状态机</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2">
            {STATE_ORDER.map((s, i) => (
              <div key={s} className="flex gap-3 rounded-md border border-border px-3 py-2">
                <div className="tnum flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">
                  {i + 1}
                </div>
                <div>
                  <div className="text-sm font-medium">{STATE_META[s].label}</div>
                  <div className="text-xs text-muted-foreground">{STATE_META[s].description}</div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            状态按实时数据逐步转换，不通过事后结果直接指定；未收盘的 4H K 线只显示 INTRABAR 试探，不构成突破确认。
          </p>
        </CardContent>
      </Card>

      {/* 分层评分 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">分层评分（不再合并成单一机会分）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {LAYERS.map((layer) => (
            <div key={layer.key}>
              <div className="mb-1 text-sm font-medium">{layer.title}</div>
              <p className="mb-2 text-xs text-muted-foreground">{layer.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {layer.items.map((it) => (
                  <span key={it} className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                    {it}
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            环境闸门与硬否决独立于所有分数：出现 Hard Veto 时，即使 Setup/Trigger 分很高也不会显示为「强机会」。
          </p>
        </CardContent>
      </Card>

      {/* 证据分层 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">证据分层（A/B/C/D）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {EVIDENCE.map((e) => (
            <div key={e.level} className="rounded-md border border-border px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="tnum flex h-5 w-5 items-center justify-center rounded bg-radar/15 text-xs font-semibold text-radar">
                  {e.level}
                </span>
                <span className="text-sm font-medium">{e.name}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{e.rule}</p>
              <p className="mt-0.5 text-xs text-muted-foreground/70">使用方式：{e.usage}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* 声明 */}
      <Card className="border-warn/30">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-warn">重要声明</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            {DISCLOSURES.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
