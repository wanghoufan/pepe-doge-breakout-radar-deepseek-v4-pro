'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import type { HistoricalEvent } from '@/lib/data-store';
import { ASSETS } from '@/lib/config';
import { formatDate, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

type CoinFilter = 'ALL' | 'PEPE' | 'DOGE';

export function HistoryGrid({ events }: { events: HistoricalEvent[] }) {
  const [coin, setCoin] = useState<CoinFilter>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    let list = events.slice();
    if (coin !== 'ALL') list = list.filter((e) => e.coin === coin);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (e) =>
          e.id.toLowerCase().includes(q) ||
          (e.campaignLabel ?? '').toLowerCase().includes(q) ||
          e.start.includes(q) ||
          e.end.includes(q),
      );
    }
    return list.sort((a, b) => a.startTs - b.startTs);
  }, [events, coin, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-border p-1">
          {(['ALL', 'PEPE', 'DOGE'] as CoinFilter[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCoin(c)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                coin === c ? 'bg-radar/15 text-radar' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {c === 'ALL' ? '全部' : c}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索 ID / 周期 / 日期…"
          className="h-9 w-full rounded-md border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-radar/50 sm:w-56"
        />
      </div>

      <div className="text-xs text-muted-foreground">共 {filtered.length} 个样本</div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((e) => {
          const meta = ASSETS[e.coin];
          return (
            <Link key={e.id} href={`/history/${e.id}`} className="group">
              <Card className="h-full transition-colors group-hover:border-radar/40">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-6 pt-5">
                  <div className="flex items-center gap-2">
                    <span className="tnum font-mono text-base font-semibold text-foreground">{e.id}</span>
                    <Badge variant="outline" style={{ color: meta.themecolor, borderColor: `${meta.themecolor}55` }}>
                      {meta.symbol}
                    </Badge>
                  </div>
                  <span className="tnum font-mono text-xs text-muted-foreground">
                    {formatDate(e.startTs)} ~ {formatDate(e.endTs)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 px-6 py-4">
                  <Metric label="启动前 ATR" value={e.preAtrPct.toFixed(2) + '%'} />
                  <Metric label="收缩比" value={e.compressionRatio.toFixed(2)} />
                  <Metric label="突破量比" value={e.breakoutVolRatio == null ? '—' : e.breakoutVolRatio.toFixed(1) + 'x'} />
                  <Metric label="峰值涨幅" value={formatPct(e.coinPeakReturn, 1)} />
                </div>
                {e.campaignLabel && (
                  <div className="border-t border-border/60 px-6 py-3">
                    <span className="tnum font-mono text-[11px] text-radar">{e.campaignId} · </span>
                    <span className="text-xs text-muted-foreground">{e.campaignLabel}</span>
                  </div>
                )}
              </Card>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 && <div className="py-12 text-center text-sm text-muted-foreground">无匹配样本</div>}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}