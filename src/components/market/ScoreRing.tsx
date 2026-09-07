'use client';

import { cn } from '@/lib/utils';

export function ScoreRing({
  value,
  label,
  color = '#2ee6a8',
  size = 96,
  sublabel,
}: {
  value: number;
  label: string;
  color?: string;
  size?: number;
  sublabel?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  const r = 40;
  const c = 2 * Math.PI * r;
  const filled = (clamped / 100) * c;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox="0 0 96 96" className="-rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(138,180,248,0.12)" strokeWidth="7" />
          <circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${c - filled}`}
            style={{ transition: 'stroke-dasharray 0.6s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum text-2xl font-semibold leading-none" style={{ color }}>
            {clamped}
          </span>
          <span className="mt-0.5 text-[10px] text-muted-foreground">/100</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {sublabel ? <div className={cn('text-[11px] text-muted-foreground')}>{sublabel}</div> : null}
      </div>
    </div>
  );
}