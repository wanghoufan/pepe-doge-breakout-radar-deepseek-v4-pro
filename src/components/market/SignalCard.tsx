'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StateBadge } from './StateBadge';
import { ScoreRing } from './ScoreRing';
import { ASSETS } from '@/lib/config';
import { formatPrice, formatPct, formatTs } from '@/lib/format';
import type { AssetId, AssetSignal } from '@/lib/types';
import { cn } from '@/lib/utils';

export function SignalCard({
  asset,
  signal,
  className,
  price,
  priceTs,
}: {
  asset: AssetId;
  signal: AssetSignal | null;
  className?: string;
  price?: number | null;
  priceTs?: number | null;
}) {
  const meta = ASSETS[asset];

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.12] blur-2xl"
        style={{ background: meta.themecolor }}
      />
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="font-mono" style={{ color: meta.themecolor }}>
              {meta.symbol}
            </span>
            <span className="text-sm font-normal text-muted-foreground">突破雷达</span>
          </CardTitle>
          {signal && (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-muted-foreground">OKX 实时价</span>
              <span className="tnum font-mono text-sm">{formatPrice(price ?? null)}</span>
              {priceTs ? (
                <span className="text-[11px] text-muted-foreground">更新于 {formatTs(priceTs)}</span>
              ) : null}
            </div>
          )}
          {signal && <p className="mt-0.5 text-[11px] text-muted-foreground">判定口径 · 4H 已收盘 K 线</p>}
        </div>
        {signal && <StateBadge state={signal.state} />}
      </CardHeader>

      <CardContent className="space-y-4">
        {!signal ? (
          <div className="py-6 text-center text-sm text-muted-foreground">实时信号不可用</div>
        ) : (
          <>
            {signal.hardVeto && (
              <div className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
                ⚠ 硬否决：{signal.hardVetoReason}
              </div>
            )}

            <div className="flex items-center justify-around">
              <ScoreRing value={signal.opportunityScore} label="机会评分" color={meta.themecolor} />
              <ScoreRing value={signal.riskScore} label="风险评分" color="#fb5e6e" />
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <LevelRow label="结构阻力" value={signal.keyLevels.resistance} />
              <LevelRow label="失效观察位" value={signal.keyLevels.invalidation} />
              <LevelRow label="EMA20" value={signal.keyLevels.ema20} />
              <LevelRow
                label="相对强度"
                value={null}
                custom={signal.features.relativeStrength == null ? '—' : formatPct(signal.features.relativeStrength)}
              />
            </div>

            {signal.reasons.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">判断依据</div>
                <ul className="space-y-1">
                  {signal.reasons.slice(0, 4).map((r, i) => (
                    <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                      <span className="text-radar">·</span>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {signal.dataQuality.degraded && (
              <div className="text-[11px] text-warn">部分条件因数据缺失不可判定：{signal.dataQuality.missingFields.join('、')}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function LevelRow({ label, value, custom }: { label: string; value: number | null; custom?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum font-mono text-foreground">{custom ?? formatPrice(value)}</span>
    </div>
  );
}