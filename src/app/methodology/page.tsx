import type { Metadata } from 'next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { STATE_META, DEFAULT_OPPORTUNITY_WEIGHTS } from '@/lib/config';

export const metadata: Metadata = {
  title: '方法论与证据规则 · PEPE/DOGE 突破雷达',
  description: '六态状态机、四层评分权重与 A/B/C/D 证据分层规则说明。',
};

const STATE_ORDER = [
  'forbidden',
  'accumulating',
  'near_breakout',
  'breakout_confirmed',
  'awaiting_pullback',
  'invalidated',
] as const;

const LAYERS = [
  {
    key: 'environment',
    title: '环境层',
    weight: 25,
    desc: '是否处于适合 meme 突破共振的大盘环境。',
    items: [
      { label: 'BTC 4H 结构风险', w: DEFAULT_OPPORTUNITY_WEIGHTS.environment.btcRisk },
      { label: 'BTC 趋势方向', w: DEFAULT_OPPORTUNITY_WEIGHTS.environment.btcTrend },
      { label: 'meme 相对 BTC', w: DEFAULT_OPPORTUNITY_WEIGHTS.environment.memeRelBtc },
      { label: '板块广度', w: DEFAULT_OPPORTUNITY_WEIGHTS.environment.breadth },
      { label: 'PEPE/DOGE 共振', w: DEFAULT_OPPORTUNITY_WEIGHTS.environment.resonance },
    ],
  },
  {
    key: 'preparation',
    title: '蓄势准备层',
    weight: 25,
    desc: '压缩是否充分——缩量缩波、结构企稳、相对强度抬头。',
    items: [
      { label: 'ATR 收缩', w: DEFAULT_OPPORTUNITY_WEIGHTS.preparation.atrCompression },
      { label: '量能收缩', w: DEFAULT_OPPORTUNITY_WEIGHTS.preparation.volumeContraction },
      { label: '结构企稳', w: DEFAULT_OPPORTUNITY_WEIGHTS.preparation.structureBase },
      { label: '阻力压缩', w: DEFAULT_OPPORTUNITY_WEIGHTS.preparation.resistanceCompression },
      { label: '相对强度', w: DEFAULT_OPPORTUNITY_WEIGHTS.preparation.relStrength },
    ],
  },
  {
    key: 'breakout',
    title: '突破触发层',
    weight: 30,
    desc: '突破是否成立并得到量能、相对强弱与回踩确认。',
    items: [
      { label: '4H 收盘突破', w: DEFAULT_OPPORTUNITY_WEIGHTS.breakout.closeBreakout },
      { label: '突破量比', w: DEFAULT_OPPORTUNITY_WEIGHTS.breakout.volumeRatio },
      { label: '持续量能', w: DEFAULT_OPPORTUNITY_WEIGHTS.breakout.persistentVolume },
      { label: '相对 BTC 走强', w: DEFAULT_OPPORTUNITY_WEIGHTS.breakout.relOutperform },
      { label: '回踩确认', w: DEFAULT_OPPORTUNITY_WEIGHTS.breakout.pullback },
    ],
  },
  {
    key: 'risk',
    title: '资金/风险层',
    weight: 20,
    desc: '拥挤度与失效条件——判断当前是否过热或已失守。',
    items: [
      { label: '不拥挤', w: DEFAULT_OPPORTUNITY_WEIGHTS.risk.notCrowded },
      { label: 'BTC 无硬退出', w: DEFAULT_OPPORTUNITY_WEIGHTS.risk.btcNoHardExit },
      { label: '币种未失效', w: DEFAULT_OPPORTUNITY_WEIGHTS.risk.coinNoInvalidation },
      { label: '追涨距离', w: DEFAULT_OPPORTUNITY_WEIGHTS.risk.chaseDistance },
      { label: '盈亏比观察', w: DEFAULT_OPPORTUNITY_WEIGHTS.risk.riskReward },
    ],
  },
];

const EVIDENCE = [
  {
    level: 'A',
    name: '一档 · 实时监测指标',
    rule: '可客观量化，用于识别蓄势/突破/过热/失效阶段（突破是否发生、量价是否配合、相对强度、波动收缩等）。',
    usage: '驱动实时状态机与评分。',
  },
  {
    level: 'B',
    name: '二档 · 结构化历史研究',
    rule: '21 个「成功上涨」历史事件（回测序号 P01–P11、D01–D10）的自相关人员，量化了常见启动前形态的时间分布。',
    usage: '提炼候选阈值与相似性参考，仅反映「成功样本长什么样」，不回测失败样本。',
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
  '当前候选规则仅来自「已被挑选的成功上涨样本」，尚未加入失败突破样本，也未与普通行情对照窗口比对，因此不存在可通报的胜率、准确率、假突破概率或收益结论。',
  '所有阈值、权重均为「候选」性质，需通过失败样本与样本外数据检验后才具备统计意义。',
  '实时行情受数据源可用性、延迟与口径影响；数据不可用时自动降级为历史研究快照并明确提示。',
  '资金费率跨交易所口径不同，仅作拥挤度方向性参考。',
];

export default function MethodologyPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-xl font-semibold">方法论与证据规则</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          雷达的判断流程：先看环境，再看蓄势，突破触发后进入观察/回踩，全程触发失效条件即退出。
        </p>
      </header>

      {/* 状态机 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">六态状态机</CardTitle>
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
        </CardContent>
      </Card>

      {/* 评分权重 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">机会评分（0–100，四层权重）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {LAYERS.map((layer) => (
            <div key={layer.key}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-medium">{layer.title}</span>
                <span className="tnum font-mono text-xs text-radar">{layer.weight} 分</span>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{layer.desc}</p>
              <div className="flex flex-wrap gap-1.5">
                {layer.items.map((it) => (
                  <span key={it.label} className="rounded-md bg-muted/50 px-2 py-1 text-xs">
                    {it.label} <span className="tnum text-muted-foreground">{it.w}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            机会评分衡量「候选条件的满足程度」，风险评分独立衡量「过热/失效风险」。二者均不映射为任何胜率或收益。
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