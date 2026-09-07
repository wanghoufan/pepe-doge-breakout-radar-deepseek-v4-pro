'use client';

import type { StateCode } from '@/lib/types';
import { STATE_META } from '@/lib/config';
import { cn } from '@/lib/utils';

const STYLE: Record<StateCode, { bg: string; text: string; ring: string; dot: string }> = {
  forbidden: { bg: 'bg-bear/10', text: 'text-bear', ring: 'border-bear/30', dot: 'bg-bear' },
  accumulating: { bg: 'bg-btc/10', text: 'text-btc', ring: 'border-btc/25', dot: 'bg-btc' },
  near_breakout: { bg: 'bg-warn/10', text: 'text-warn', ring: 'border-warn/30', dot: 'bg-warn' },
  breakout_confirmed: { bg: 'bg-radar/10', text: 'text-radar', ring: 'border-radar/30', dot: 'bg-radar' },
  awaiting_pullback: { bg: 'bg-chart-4/10', text: 'text-chart-4', ring: 'border-chart-4/25', dot: 'bg-chart-4' },
  invalidated: { bg: 'bg-muted', text: 'text-muted-foreground', ring: 'border-border', dot: 'bg-muted-foreground' },
};

export function StateBadge({ state, className }: { state: StateCode; className?: string }) {
  const meta = STATE_META[state];
  const s = STYLE[state];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        s.bg,
        s.text,
        s.ring,
        className,
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', s.dot, state === 'breakout_confirmed' && 'state-dot')} />
      {meta.label}
    </span>
  );
}