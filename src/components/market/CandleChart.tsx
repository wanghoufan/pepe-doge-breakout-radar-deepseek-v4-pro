'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import type { Candle } from '@/lib/types';
import { emaSeries } from '@/lib/indicators';
import { formatPrice, formatTs, formatCompact } from '@/lib/format';

export interface ChartMarker {
  ts: number;
  label: string;
  kind: 'breakout' | 'range' | 'event';
}

const COLORS = {
  bull: '#34d399',
  bear: '#fb5e6e',
  ema20: '#7fb3ff',
  ema50: '#f5b544',
  ema100: '#c084fc',
  marker: '#fdba74',
};

const HEIGHT = 400;
const VOLUME_H = 72;
const PAD_RIGHT = 56;
const PAD_LEFT = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 20;

export function CandleChart({
  candles,
  markers = [],
  showEma = true,
}: {
  candles: Candle[];
  markers?: ChartMarker[];
  showEma?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const measure = () => setWidth(ref.current?.clientWidth ?? 720);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const chart = useMemo(() => {
    const n = candles.length;
    const closes = candles.map((c) => c.c);
    const ema20 = emaSeries(closes, 20);
    const ema50 = emaSeries(closes, 50);
    const ema100 = emaSeries(closes, 100);
    const highs = candles.map((c) => c.h);
    const lows = candles.map((c) => c.l);
    const maxVol = Math.max(...candles.map((c) => c.quoteVol), 1);

    const priceMax = Math.max(...highs, ...ema20, ...ema50, ...ema100);
    const priceMin = Math.min(...lows, ...ema20, ...ema50, ...ema100);

    const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM - VOLUME_H - 14;
    const plotW = Math.max(10, width - PAD_LEFT - PAD_RIGHT);
    const slotW = n > 1 ? plotW / n : plotW;
    const bodyW = Math.max(1.5, Math.min(10, slotW * 0.6));

    const y = (v: number) => {
      const range = priceMax - priceMin || 1;
      return PAD_TOP + ((priceMax - v) / range) * plotH;
    };
    const x = (i: number) => PAD_LEFT + (i + 0.5) * slotW;

    const volY = (v: number) => PAD_TOP + plotH + 14 + VOLUME_H - (v / maxVol) * VOLUME_H;

    return { n, ema20, ema50, ema100, priceMax, priceMin, plotH, plotW, slotW, bodyW, y, x, volY, maxVol };
  }, [candles, width]);

  const tickValues = useMemo(() => {
    const { priceMin, priceMax, plotH } = chart;
    const steps = 5;
    const out: { v: number; y: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const v = priceMax - ((priceMax - priceMin) * i) / steps;
      const range = priceMax - priceMin || 1;
      out.push({ v, y: PAD_TOP + ((priceMax - v) / range) * plotH });
    }
    return out;
  }, [chart]);

  const timeTicks = useMemo(() => {
    const { n, x } = chart;
    if (n === 0) return [];
    const count = Math.min(5, n);
    const out: { ts: number; x: number }[] = [];
    for (let k = 0; k < count; k++) {
      const i = Math.round((k * (n - 1)) / (count - 1 || 1));
      out.push({ ts: candles[i].ts, x: x(i) });
    }
    return out;
  }, [chart, candles]);

  const markerByTs = useMemo(() => {
    const m = new Map<number, ChartMarker>();
    for (const mk of markers) m.set(mk.ts, mk);
    return m;
  }, [markers]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const { slotW, n } = chart;
    const idx = Math.floor((mx - PAD_LEFT) / slotW);
    if (idx < 0 || idx >= n) {
      setHover(null);
      return;
    }
    setHover(idx);
  };

  const hoverCandle = hover != null ? candles[hover] : null;
  const markerAtHover = hoverCandle ? markerByTs.get(hoverCandle.ts) : null;

  return (
    <div ref={ref} className="relative w-full select-none">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {showEma && (
          <>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-0.5 w-4 bg-[#7fb3ff]" />EMA20
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-0.5 w-4 bg-[#f5b544]" />EMA50
            </span>
            <span className="flex items-center gap-1.5">
              <i className="inline-block h-0.5 w-4 bg-[#c084fc]" />EMA100
            </span>
          </>
        )}
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-2 rounded-[2px] bg-[#34d399]" />涨
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-2 rounded-[2px] bg-[#fb5e6e]" />跌
        </span>
        {markers.length > 0 && (
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-3 w-0.5 bg-[#fdba74]" />事件标注
          </span>
        )}
      </div>

      <svg
        width={width}
        height={HEIGHT}
        className="overflow-visible"
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* 网格 */}
        {tickValues.map((t, i) => (
          <g key={i}>
            <line x1={PAD_LEFT} x2={PAD_LEFT + chart.plotW} y1={t.y} y2={t.y} stroke="rgba(138,180,248,0.08)" strokeWidth="1" />
            <text x={PAD_LEFT + chart.plotW + 6} y={t.y + 3} fontSize="10" fill="#8593a6" className="tnum">
              {formatPrice(t.v)}
            </text>
          </g>
        ))}

        {/* 成交量 */}
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const color = up ? COLORS.bull : COLORS.bear;
          const vh = Math.max(1, (c.quoteVol / chart.maxVol) * VOLUME_H);
          return (
            <rect
              key={`v${i}`}
              x={chart.x(i) - chart.bodyW / 2}
              y={chart.volY(c.quoteVol)}
              width={chart.bodyW}
              height={vh}
              fill={color}
              opacity={hover === i ? 0.85 : 0.28}
            />
          );
        })}

        {/* K 线 */}
        {candles.map((c, i) => {
          const up = c.c >= c.o;
          const color = up ? COLORS.bull : COLORS.bear;
          const cx = chart.x(i);
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={chart.y(c.h)} y2={chart.y(c.l)} stroke={color} strokeWidth="1" />
              <rect
                x={cx - chart.bodyW / 2}
                y={chart.y(Math.max(c.o, c.c))}
                width={chart.bodyW}
                height={Math.max(1, Math.abs(chart.y(c.o) - chart.y(c.c)))}
                fill={color}
                opacity={hover === i ? 1 : 0.92}
              />
            </g>
          );
        })}

        {/* EMA */}
        {showEma &&
          (
            [
              { s: chart.ema20, color: COLORS.ema20 },
              { s: chart.ema50, color: COLORS.ema50 },
              { s: chart.ema100, color: COLORS.ema100 },
            ] as const
          ).map((line, li) => {
            const pts = candles.map((_, i) => `${chart.x(i)},${chart.y(line.s[i])}`).join(' ');
            return (
              <polyline key={li} points={pts} fill="none" stroke={line.color} strokeWidth="1.3" opacity="0.9" />
            );
          })}

        {/* 事件标注 */}
        {markers.map((mk, i) => {
          const idx = candles.findIndex((c) => c.ts === mk.ts);
          if (idx < 0) return null;
          const cx = chart.x(idx);
          return (
            <g key={i}>
              <line x1={cx} x2={cx} y1={PAD_TOP} y2={PAD_TOP + chart.plotH} stroke={COLORS.marker} strokeDasharray="3 3" strokeWidth="1" />
              <rect x={cx + 4} y={PAD_TOP + 2} rx="3" fill="rgba(253,186,116,0.14)" stroke="rgba(253,186,116,0.5)" strokeWidth="0.5" />
              <text x={cx + 8} y={PAD_TOP + 7} fontSize="9" fill="#fdba74" className="tnum" dy="4">
                {mk.label}
              </text>
            </g>
          );
        })}

        {/* 悬浮十字线 */}
        {hover != null && (
          <line x1={chart.x(hover)} x2={chart.x(hover)} y1={PAD_TOP} y2={PAD_TOP + chart.plotH + VOLUME_H + 14} stroke="rgba(230,237,246,0.35)" strokeWidth="1" />
        )}

        {/* 时间轴 */}
        {timeTicks.map((t, i) => (
          <text key={i} x={t.x} y={HEIGHT - 4} fontSize="10" fill="#8593a6" textAnchor="middle" className="tnum">
            {formatTs(t.ts, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).slice(5)}
          </text>
        ))}
      </svg>

      {/* 悬浮信息 */}
      {hoverCandle && (
        <div className="pointer-events-none absolute left-2 top-14 rounded-md border border-border bg-popover/95 px-3 py-2 text-[11px] shadow-lg backdrop-blur">
          <div className="tnum text-muted-foreground">{formatTs(hoverCandle.ts)}</div>
          <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 tnum">
            <span className="text-muted-foreground">开</span>
            <span>{formatPrice(hoverCandle.o)}</span>
            <span className="text-muted-foreground">高</span>
            <span>{formatPrice(hoverCandle.h)}</span>
            <span className="text-muted-foreground">低</span>
            <span>{formatPrice(hoverCandle.l)}</span>
            <span className="text-muted-foreground">收</span>
            <span style={{ color: hoverCandle.c >= hoverCandle.o ? COLORS.bull : COLORS.bear }}>
              {formatPrice(hoverCandle.c)}
            </span>
            <span className="text-muted-foreground">额</span>
            <span>{formatCompact(hoverCandle.quoteVol)}</span>
          </div>
          {markerAtHover && <div className="mt-1 text-[#fdba74]">◈ {markerAtHover.label}</div>}
        </div>
      )}
    </div>
  );
}