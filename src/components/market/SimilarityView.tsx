'use client';

import { useMemo, useState } from 'react';
import { useApi, type ApiState } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ASSETS } from '@/lib/config';
import { cn } from '@/lib/utils';

interface SimEventSummary {
  id: string;
  coin: string;
  start: string;
  end: string;
  campaignId: string | null;
  campaignLabel: string | null;
}
interface Neighbor {
  eventId: string;
  score: number;
  distance: number;
  sharedDims: number;
}
interface SimilarityResp {
  ok: boolean;
  data: {
    features: { key: string; label: string; lowerBetter: boolean }[];
    events: SimEventSummary[];
    matrix: { id: string; neighbors: Neighbor[] }[];
    scatter: { id: string; x: number; y: number }[];
  };
}

interface CurrentResp {
  ok: boolean;
  status: 'live' | 'unavailable';
  coin: string;
  data: { query: { label: string; value: number | null }[]; ranking: Neighbor[] } | null;
}

export function SimilarityView() {
  const sim = useApi<SimilarityResp>('/api/similarity');
  const pepeCur = useApi<CurrentResp>('/api/similarity/current?coin=PEPE');
  const dogeCur = useApi<CurrentResp>('/api/similarity/current?coin=DOGE');
  const [anchor, setAnchor] = useState<string | null>(null);

  const events = sim.data?.data.events ?? [];
  const matrix = sim.data?.data.matrix ?? [];
  const scatter = sim.data?.data.scatter ?? [];
  const features = sim.data?.data.features ?? [];

  const byId = useMemo(() => {
    const m = new Map<string, SimEventSummary>();
    events.forEach((e) => m.set(e.id, e));
    return m;
  }, [events]);

  const neighbors = useMemo(() => {
    if (!anchor) return [];
    const row = matrix.find((r) => r.id === anchor);
    return (row?.neighbors ?? []).slice(0, 8);
  }, [anchor, matrix]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">形态相似性</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          仅用「启动前」特征（收缩比、量比、启动前收益、启动前 ATR、启动前费率）对 21 个历史事件做相似度对比，作为方向性参考，不构成任何概率或收益结论。
        </p>
      </header>

      {/* 特征定义 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">对比特征（启动前，可比较，不事后改写）</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {features.map((f) => (
            <Badge key={f.key} variant="outline" className="text-xs font-normal">
              {f.label}
              <span className="ml-1 text-muted-foreground">{f.lowerBetter ? '↓ 越小越收缩' : ''}</span>
            </Badge>
          ))}
        </CardContent>
      </Card>

      {/* 当前像谁 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <CurrentPanel coin="PEPE" resp={pepeCur} byId={byId} />
        <CurrentPanel coin="DOGE" resp={dogeCur} byId={byId} />
      </div>

      {/* 散点投影 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            事件近似分布（PCA 二维投影，仅可视化，不构成统计结论）
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ScatterPlot points={scatter} byId={byId} onSelect={setAnchor} selected={anchor} />
        </CardContent>
      </Card>

      {/* 锚点邻居 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            相似邻居{anchor ? `（以 ${anchor} 为锚点，Top ${neighbors.length}）` : ''}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!anchor ? (
            <p className="py-6 text-center text-sm text-muted-foreground">点击上方散点图中的一个事件作为锚点</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {neighbors.map((n) => {
                const e = byId.get(n.eventId);
                return (
                  <div key={n.eventId} className="rounded-md border border-border px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm" style={{ color: e ? ASSETS[e.coin as 'PEPE' | 'DOGE'].themecolor : undefined }}>
                        {n.eventId}
                      </span>
                      <span className="tnum font-mono text-xs text-radar">{(n.score * 100).toFixed(0)}%</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{e ? `${e.coin} · ${e.start.slice(0, 10)}` : ''}</span>
                      <span>共享 {n.sharedDims}/5 维</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CurrentPanel({
  coin,
  resp,
  byId,
}: {
  coin: string;
  resp: ApiState<CurrentResp>;
  byId: Map<string, SimEventSummary>;
}) {
  const meta = ASSETS[coin as 'PEPE' | 'DOGE'];
  const top = resp.data?.data?.ranking.slice(0, 5) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium" style={{ color: meta.themecolor }}>
          当前 {coin} 像谁
        </CardTitle>
      </CardHeader>
      <CardContent>
        {resp.data?.status === 'live' && resp.data.data ? (
          <div className="space-y-2">
            {top.map((n) => {
              const e = byId.get(n.eventId);
              return (
                <div key={n.eventId} className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className="font-mono">{n.eventId}</span>
                  <span className="text-xs text-muted-foreground">{e ? `${e.coin} · ${e.start.slice(0, 10)}` : ''}</span>
                  <span className="tnum font-mono text-xs text-radar">{(n.score * 100).toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            实时数据不可用，「当前像谁」需部署到可访问 OKX 的环境后启用。
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ScatterPlot({
  points,
  byId,
  onSelect,
  selected,
}: {
  points: { id: string; x: number; y: number }[];
  byId: Map<string, SimEventSummary>;
  onSelect: (id: string) => void;
  selected: string | null;
}) {
  const W = 720;
  const H = 340;
  const pad = 32;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const sx = (x: number) => pad + ((x - minX) / (maxX - minX || 1)) * (W - pad * 2);
  const sy = (y: number) => H - pad - ((y - minY) / (maxY - minY || 1)) * (H - pad * 2);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <rect x="0" y="0" width={W} height={H} fill="transparent" />
      {points.map((p) => {
        const e = byId.get(p.id);
        const color = e ? ASSETS[e.coin as 'PEPE' | 'DOGE'].themecolor : '#888';
        const isSel = p.id === selected;
        return (
          <g key={p.id} onClick={() => onSelect(p.id)} className="cursor-pointer">
            <circle cx={sx(p.x)} cy={sy(p.y)} r={isSel ? 7 : 5} fill={color} opacity={isSel ? 1 : 0.75} stroke={isSel ? '#fff' : 'none'} strokeWidth={1.5} />
            <title>{`${p.id}${e ? ` · ${e.coin}` : ''}`}</title>
          </g>
        );
      })}
    </svg>
  );
}