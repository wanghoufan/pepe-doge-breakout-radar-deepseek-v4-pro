'use client';

import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalCard } from './SignalCard';
import { SourceLine, DiagBox, SourceFreshnessRow, CandleFreshnessBlock } from './DataStatus';
import { formatPrice, formatPct, formatTs, relativeTime } from '@/lib/format';
import { OKX_PERP_LINE } from '@/lib/config';
import type { FeedFreshness, FeedStatus } from '@/lib/freshness';
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
  freshness?: FeedFreshness | null;
  // 分标新鲜度（服务端分标隔离口径；缺字段的老 payload 按全局 freshness 回退）。
  freshnessByCoin?: Record<'PEPE' | 'DOGE' | 'ETHFI', FeedFreshness> | null;
  fundingTs?: Record<'PEPE' | 'DOGE' | 'ETHFI', number | null> | null;
  // Phase A K 线新鲜度（期望收盘 Bar 对比口径，open/close 语义见 time.ts）。
  candle?: {
    current4HOpenTs: number;
    expectedLastConfirmedOpenTs: number;
    expectedLastConfirmedCloseTs: number;
    lastConfirmedOpenTs: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', number | null>;
    lastConfirmedCloseTs: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', number | null>;
    candleLagBars: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', number | null>;
    freshnessStatus: 'LIVE' | 'STALE' | 'UNAVAILABLE';
    staleReason: string | null;
  } | null;
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
    ethfi: AssetSignal | null;
    lastCandleTs: number | null;
    lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null; ETHFI: number | null };
    intraday: { PEPE: Candle | null; DOGE: Candle | null; BTC: Candle | null; ETHFI: Candle | null };
    prices: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', { last: number; ts: number } | null>;
    sources: {
      okxCandles: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', SourceDiagLike>;
      okxTickers: SourceDiagLike;
      funding: Record<'PEPE' | 'DOGE' | 'ETHFI', SourceDiagLike>;
    };
  };
}

export function LiveRadar() {
  const { data, loading, error, refresh } = useApi<OverviewResp>('/api/market/overview');

  const live = data?.status === 'live';
  const btc = data?.data.btc;
  const sources = data?.data.sources;
  const failedDiag = sources
    ? [sources.okxCandles.BTC, sources.okxCandles.PEPE, sources.okxCandles.DOGE, sources.okxCandles.ETHFI, sources.okxTickers].find((d) => !d.ok)
    : undefined;
  // P0-1 三态：优先用服务端 freshness；缺字段时按 live 回退（不改变旧行为）。
  const feedStatus = data?.freshness?.status ?? (data ? (live ? 'ok' : 'unavailable') : 'unavailable');
  const staleReason = data?.freshness?.reason ?? (live ? null : (data?.error ?? 'OKX 实时数据当前不可用'));
  const freshnessTs = data?.freshness?.lastUpdatedTs ?? data?.data.lastCandleTs ?? null;
  // 分标隔离：各卡用本标 freshness（缺字段回退全局，不改变旧 payload 行为）。
  const coinStatus = (coin: 'PEPE' | 'DOGE' | 'ETHFI'): FeedStatus =>
    data?.freshnessByCoin?.[coin]?.status ?? (data ? feedStatus : 'unavailable');
  const coinReason = (coin: 'PEPE' | 'DOGE' | 'ETHFI'): string | null | undefined =>
    data?.freshnessByCoin?.[coin]?.reason ?? (data ? staleReason : undefined);

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
          <SourceLine provider="okx" instId={OKX_PERP_LINE} fetchedAt={data.generatedAt} />
          {data.candle ? (
            <span>
              最近4H收盘 {formatTs(data.candle.expectedLastConfirmedCloseTs)} · K线{data.candle.freshnessStatus}
              {data.candle.staleReason ? `（${data.candle.staleReason}）` : ''}
            </span>
          ) : (
            <span>最后已收盘 4H K 线 {formatTs(data.data.lastCandleTs)}</span>
          )}
          <span>
            资金费率来源 {data.fundingProvider === 'okx' ? 'OKX（Binance 不可用）' : data.fundingProvider === 'binance' ? 'Binance' : '不可用'}
          </span>
          {feedStatus !== 'ok' && freshnessTs != null && (
            <span className="min-w-0 break-words text-warn">数据{feedStatus === 'stale' ? '已过期' : '不可用'}：{staleReason} · 最后有效更新 {formatTs(freshnessTs)}</span>
          )}
        </div>
      )}

      {data && (
        <SourceFreshnessRow
          generatedAt={data.generatedAt}
          lastConfirmedTs={data.data.lastConfirmedTs}
          prices={data.data.prices}
          fundingTs={data.fundingTs ?? null}
        />
      )}

      {/* Phase A：现价与 K 线新鲜度分离显示（三行 × PEPE/DOGE/ETHFI，全站统一口径）。 */}
      {data && (
        <div className="grid gap-3 md:grid-cols-3">
          <CandleFreshnessBlock
            coin="PEPE"
            priceTs={data.data.prices?.PEPE?.ts ?? null}
            actualOpenTs={data.data.lastConfirmedTs.PEPE}
            now={data.generatedAt}
          />
          <CandleFreshnessBlock
            coin="DOGE"
            priceTs={data.data.prices?.DOGE?.ts ?? null}
            actualOpenTs={data.data.lastConfirmedTs.DOGE}
            now={data.generatedAt}
          />
          <CandleFreshnessBlock
            coin="ETHFI"
            priceTs={data.data.prices?.ETHFI?.ts ?? null}
            actualOpenTs={data.data.lastConfirmedTs.ETHFI}
            now={data.generatedAt}
          />
        </div>
      )}

      {/* LOW-15：首载骨架占位（min-h 防 CLS，三卡同高）。 */}
      {loading && !data && (
        <div className="grid gap-4 md:grid-cols-3" aria-busy="true" aria-label="实时雷达加载中">
          {(['PEPE', 'DOGE', 'ETHFI'] as const).map((c) => (
            <div key={c} className="min-h-[220px] space-y-2 rounded-lg border border-border/60 p-4">
              <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted/70" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-muted/70" />
              <div className="h-4 w-4/6 animate-pulse rounded bg-muted/70" />
            </div>
          ))}
        </div>
      )}

      {!live && !loading && (
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

      <div className="grid gap-4 md:grid-cols-3">
        <SignalCard
          asset="PEPE"
          signal={data?.data.pepe ?? null}
          loading={loading && !data}
          price={data?.data.prices?.PEPE?.last ?? null}
          priceTs={data?.data.prices?.PEPE?.ts ?? null}
          dataStatus={data ? coinStatus('PEPE') : undefined}
          staleReason={data ? coinReason('PEPE') : undefined}
        />
        <SignalCard
          asset="DOGE"
          signal={data?.data.doge ?? null}
          loading={loading && !data}
          price={data?.data.prices?.DOGE?.last ?? null}
          priceTs={data?.data.prices?.DOGE?.ts ?? null}
          dataStatus={data ? coinStatus('DOGE') : undefined}
          staleReason={data ? coinReason('DOGE') : undefined}
        />
        <SignalCard
          asset="ETHFI"
          signal={data?.data.ethfi ?? null}
          loading={loading && !data}
          price={data?.data.prices?.ETHFI?.last ?? null}
          priceTs={data?.data.prices?.ETHFI?.ts ?? null}
          dataStatus={data ? coinStatus('ETHFI') : undefined}
          staleReason={data ? coinReason('ETHFI') : undefined}
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
