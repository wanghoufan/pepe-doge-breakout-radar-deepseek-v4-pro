'use client';

import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalCard } from './SignalCard';
import { SourceLine, DiagBox } from './DataStatus';
import { formatPrice, formatPct, formatTs, relativeTime } from '@/lib/format';
import type { AssetSignal, Candle } from '@/lib/types';

interface SourceDiagLike {
  provider: string;
  ok: boolean;
  url: string | null;
  host: string | null;
  httpStatus: number | null;
  vendorCode: string | null;
  vendorMsg: string | null;
  errorKind: string | null;
  errorDetail: string | null;
}

interface OverviewResp {
  ok: boolean;
  status: 'live' | 'unavailable';
  generatedAt: number;
  summary: string;
  error: string | null;
  errors: string[];
  fundingProvider: 'binance' | 'okx' | null;
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
    lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
    intraday: { PEPE: Candle | null; DOGE: Candle | null; BTC: Candle | null };
    prices: Record<'PEPE' | 'DOGE' | 'BTC', { last: number; ts: number } | null>;
    sources: {
      okxCandles: Record<'PEPE' | 'DOGE' | 'BTC', SourceDiagLike>;
      okxTickers: SourceDiagLike;
      funding: Record<'PEPE' | 'DOGE', SourceDiagLike>;
    };
  };
}

export function LiveRadar() {
  const { data, loading, error, refresh } = useApi<OverviewResp>('/api/market/overview');

  const live = data?.status === 'live';
  const btc = data?.data.btc;
  const sources = data?.data.sources;
  const failedDiag = sources
    ? [sources.okxCandles.BTC, sources.okxCandles.PEPE, sources.okxCandles.DOGE, sources.okxTickers].find((d) => !d.ok)
    : undefined;

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
              {live ? 'OKX 在线' : 'OKX 不可用'}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          {loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {data && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <SourceLine provider="okx" instId="PEPE/DOGE/BTC-USDT-SWAP" fetchedAt={data.generatedAt} />
          <span>最后已收盘 4H K 线 {formatTs(data.data.lastCandleTs)}</span>
          <span>
            资金费率来源 {data.fundingProvider === 'okx' ? 'OKX（Binance 不可用）' : data.fundingProvider === 'binance' ? 'Binance' : '不可用'}
          </span>
        </div>
      )}

      {!live && (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="flex flex-col gap-3 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">OKX 实时数据当前不可用（未使用任何快照冒充）</p>
            {data?.errors?.length ? (
              <ul className="list-disc space-y-1 pl-5 text-[12px]">
                {data.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p>{error ?? '正在拉取 OKX 实时行情…'}</p>
            )}
            <DiagBox diag={failedDiag} title="OKX 请求诊断" />
            <p className="text-[11px]">
              下方「历史样本」与各币种的历史形态快照来自研究快照，不受实时接口影响。
            </p>
          </CardContent>
        </Card>
      )}

      {btc && live && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">BTC 环境（OKX）</CardTitle>
            <span className="text-[11px] text-muted-foreground">
              更新于 {formatTs(btc.priceTs)}（{relativeTime(btc.priceTs)}）
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
        <SignalCard
          asset="PEPE"
          signal={data?.data.pepe ?? null}
          price={data?.data.prices?.PEPE?.last ?? null}
          priceTs={data?.data.prices?.PEPE?.ts ?? null}
        />
        <SignalCard
          asset="DOGE"
          signal={data?.data.doge ?? null}
          price={data?.data.prices?.DOGE?.last ?? null}
          priceTs={data?.data.prices?.DOGE?.ts ?? null}
        />
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
