import Link from 'next/link';
import { LiveRadar } from '@/components/market/LiveRadar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHistoricalEvents } from '@/lib/data-store';
import { CAMPAIGNS } from '@/lib/event-analysis';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const events = getHistoricalEvents();
  const pepeCount = events.filter((e) => e.coin === 'PEPE').length;
  const dogeCount = events.filter((e) => e.coin === 'DOGE').length;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="radar-grid relative overflow-hidden rounded-xl border border-border/70 px-6 py-10 sm:px-10">
        <div className="radar-sweep pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-radar">Breakout Radar · Research Tool</p>
          <h1 className="mt-3 max-w-2xl text-2xl font-semibold leading-tight sm:text-3xl">
            PEPE·DOGE·ETHFI 突破雷达
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            把当前 PEPE / DOGE / ETHFI 的量价、波动与资金费率状态，与 21 个历史上涨行情样本做对照，
            用「此刻更像哪一段历史」来组织证据——而不是给出买卖信号。
            ETHFI 暂无历史基线样本（实时信号与历史对照仅覆盖 PEPE/DOGE）。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/history"
              className="rounded-md bg-radar px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              浏览 21 个历史样本
            </Link>
            <Link
              href="/methodology"
              className="rounded-md border border-border px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent"
            >
              研究方法与边界
            </Link>
          </div>
        </div>
      </section>

      {/* 实时雷达 */}
      <LiveRadar />

      {/* 历史证据概览 */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">历史证据概览</h2>
        <div className="grid gap-4 sm:grid-cols-4">
          <StatCard title="历史样本总数" value={String(events.length)} sub="已挑选的上涨行情波段" />
          <StatCard title="PEPE 样本" value={String(pepeCount)} sub="P01 ~ P11" />
          <StatCard title="DOGE 样本" value={String(dogeCount)} sub="D01 ~ D10" />
          <StatCard title="ETHFI 样本" value="0" sub="暂无历史基线（空缺标注）" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">行情周期（campaign）</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CAMPAIGNS.map((c) => (
                <div key={c.campaignId} className="rounded-md border border-border/60 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="tnum font-mono text-xs text-radar">{c.campaignId}</span>
                    <span className="tnum font-mono text-[11px] text-muted-foreground">
                      {c.eventIds.join(' · ')}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-foreground">{c.label}</div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              周期归属基于时间接近度与同轮市场行情的人工判断，仅用于组织叙述，不构成统计分组结论。
            </p>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function StatCard({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="py-5">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="tnum mt-1 font-mono text-3xl font-semibold text-foreground">{value}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}