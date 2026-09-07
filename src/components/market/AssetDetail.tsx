'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/market/StateBadge';
import { ScoreRing } from '@/components/market/ScoreRing';
import { CandleChart } from '@/components/market/CandleChart';
import type { Candle, AssetSignal, Timeframe } from '@/lib/types';
import { ASSETS } from '@/lib/config';
import { formatPrice, formatPct } from '@/lib/format';
import { cn } from '@/lib/utils';

interface CandlesResp {
  ok: boolean;
  source: 'live' | 'snapshot';
  degraded?: boolean;
  note?: string;
  data: { instId: string; bar: string; candles: Candle[]; until: number | null };
  message?: string;
}

interface FundingResp {
  ok: boolean;
  source: 'live' | 'snapshot';
  degraded?: boolean;
  note?: string;
  data: { symbol: string; points: { ts: number; rate: number }[] };
  message?: string;
}

interface OverviewResp {
  ok: boolean;
  status: 'live' | 'unavailable';
  data: { pepe: AssetSignal | null; doge: AssetSignal | null };
}

const TIMEFRAMES: { key: Timeframe; label: string }[] = [
  { key: '1H', label: '1H' },
  { key: '4H', label: '4H' },
  { key: '1D', label: '1D' },
];

export function AssetDetail({ coin }: { coin: 'PEPE' | 'DOGE' }) {
  const meta = ASSETS[coin];
  const [tf, setTf] = useState<Timeframe>('4H');

  const candlesApi = useApi<CandlesResp>(`/api/market/candles?coin=${coin}&bar=${tf}&limit=140`);
  const fundingApi = useApi<FundingResp>(`/api/market/funding?coin=${coin}&limit=30`);
  const overviewApi = useApi<OverviewResp>('/api/market/overview');

  const signal = coin === 'PEPE' ? overviewApi.data?.data.pepe : overviewApi.data?.data.doge;
  const live = overviewApi.data?.status === 'live';

  const candles = candlesApi.data?.data.candles ?? [];
  const source = candlesApi.data?.source;
  const until = candlesApi.data?.data.until ?? null;

  const funding = fundingApi.data?.data.points ?? [];
  const fundingAvg = funding.length
    ? (funding.reduce((s, r) => s + r.rate, 0) / funding.length) * 100
    : null;
  const fundingMax = funding.length ? Math.max(...funding.map((r) => r.rate)) * 100 : null;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold" style={{ color: meta.themecolor }}>
            {meta.symbol}
          </h1>
          <span className="text-sm text-muted-foreground">突破雷达 · 现货/永续 4H 口径</span>
        </div>
        {signal ? <StateBadge state={signal.state} /> : null}
      </header>

      {/* 评分 */}
      {signal && (
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_2fr]">
          <Card>
            <CardContent className="flex items-center justify-center py-5">
              <ScoreRing value={signal.opportunityScore} label="机会评分" color={meta.themecolor} />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center justify-center py-5">
              <ScoreRing value={signal.riskScore} label="风险评分" color="#fb5e6e" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-5">
              {signal.hardVeto && (
                <div className="mb-3 rounded-md border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
                  ⚠ 硬否决：{signal.hardVetoReason}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Level label="结构阻力" value={formatPrice(signal.keyLevels.resistance)} />
                <Level label="失效观察位" value={formatPrice(signal.keyLevels.invalidation)} />
                <Level label="回踩下沿" value={formatPrice(signal.keyLevels.pullbackLower)} />
                <Level label="EMA20" value={formatPrice(signal.keyLevels.ema20)} />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {!signal && !overviewApi.loading && (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="py-4 text-sm text-muted-foreground">
            实时信号不可用，当前展示历史快照 K 线。部署到可访问 OKX / Binance 的环境后自动切换实时雷达。
          </CardContent>
        </Card>
      )}

      {/* 图表 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium">
            价格与量能
            {source === 'snapshot' && <span className="ml-2 text-[11px] text-warn">历史快照</span>}
          </CardTitle>
          <div className="flex gap-1 rounded-lg border border-border p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTf(t.key)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  tf === t.key ? 'bg-radar/15 text-radar' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {candles.length ? (
            <CandleChart candles={candles} showEma />
          ) : candlesApi.loading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">加载中…</div>
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              {candlesApi.error ?? '该周期实时数据不可用，请切换 4H 查看历史快照'}
            </div>
          )}
          {until && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              数据截至 {new Date(until).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（UTC+8）
            </p>
          )}
          {candlesApi.data?.note && <p className="mt-1 text-[11px] text-warn">{candlesApi.data.note}</p>}
        </CardContent>
      </Card>

      {/* 资金费率 + 证据 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">
              资金费率{fundingApi.data?.degraded ? '（历史快照）' : ''}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">期间均值</div>
                <div className="tnum font-mono text-sm">{formatPct(fundingAvg, 4)}</div>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">期间峰值</div>
                <div className="tnum font-mono text-sm">{formatPct(fundingMax, 4)}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              资金费率仅作拥挤度方向性参考，跨交易所口径不同，不单独下结论。
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">信号判断依据</CardTitle>
          </CardHeader>
          <CardContent>
            {signal ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {signal.metConditions.slice(0, 8).map((c) => (
                  <div key={c.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="text-radar">✓</span>
                    <span className="truncate">{c.label}</span>
                  </div>
                ))}
                {signal.missingConditions.slice(0, 4).map((c) => (
                  <div key={c.key} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <span className="text-muted-foreground">·</span>
                    <span className="truncate">{c.label}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center text-sm text-muted-foreground">实时信号不可用</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Level({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="tnum font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}