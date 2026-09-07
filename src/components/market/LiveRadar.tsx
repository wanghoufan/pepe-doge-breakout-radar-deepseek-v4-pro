'use client';

import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalCard } from './SignalCard';
import { formatPrice, formatPct, relativeTime } from '@/lib/format';
import type { AssetSignal } from '@/lib/types';

interface OverviewResp {
  ok: boolean;
  status: 'live' | 'unavailable';
  generatedAt: number;
  summary: string;
  error: string | null;
  data: {
    btc: {
      symbol: string;
      price: number | null;
      priceTs: number | null;
      return7dPct: number | null;
      maxDrawdown24hPct: number | null;
      closeAboveEma100: boolean | null;
      source: 'okx' | 'unavailable';
    };
    pepe: AssetSignal | null;
    doge: AssetSignal | null;
    lastCandleTs: number | null;
  };
}

export function LiveRadar() {
  const { data, loading, error, refresh } = useApi<OverviewResp>('/api/market/overview');

  const live = data?.status === 'live';
  const btc = data?.data.btc;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            实时雷达 · 4H
          </h2>
          {data && (
            <span
              className={
                live
                  ? 'inline-flex items-center gap-1.5 rounded-full border border-radar/30 bg-radar/10 px-2 py-0.5 text-[11px] text-radar'
                  : 'inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 px-2 py-0.5 text-[11px] text-warn'
              }
            >
              <span className={live ? 'h-1.5 w-1.5 rounded-full bg-radar state-dot' : 'h-1.5 w-1.5 rounded-full bg-warn'} />
              {live ? '在线' : '离线 · 历史模式'}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {!live && (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="flex flex-col gap-2 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">实时数据当前不可用</p>
            <p>
              {error
                ? `第三方行情接口无法访问（${error}），可能受当前部署环境的网络策略限制。`
                : '正在拉取 OKX / Binance 实时行情…'}
            </p>
            <p>
              部署到可访问 OKX / Binance 的环境后，本区域会自动切换为实时雷达；
              下方「历史样本」与各币种的历史形态快照仍可完整浏览。
            </p>
          </CardContent>
        </Card>
      )}

      {btc && live && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">BTC 环境</CardTitle>
            <span className="text-[11px] text-muted-foreground">
              更新于 {data ? relativeTime(data.generatedAt) : '—'}
            </span>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <EnvStat label="BTC 价格" value={btc.price == null ? '—' : formatPrice(btc.price)} />
            <EnvStat label="近 7 日" value={formatPct(btc.return7dPct)} />
            <EnvStat label="24h 最大回撤" value={btc.maxDrawdown24hPct == null ? '—' : formatPct(btc.maxDrawdown24hPct)} />
            <EnvStat
              label="相对 EMA100"
              value={btc.closeAboveEma100 == null ? '—' : btc.closeAboveEma100 ? '上方' : '下方'}
            />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <SignalCard asset="PEPE" signal={data?.data.pepe ?? null} />
        <SignalCard asset="DOGE" signal={data?.data.doge ?? null} />
      </div>
    </section>
  );
}

function EnvStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}