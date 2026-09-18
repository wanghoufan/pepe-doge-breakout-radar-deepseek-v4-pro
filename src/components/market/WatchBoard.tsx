'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SignalCard } from './SignalCard';
import { AssetPicker, type EnabledAsset } from './AssetPicker';
import { SourceLine, DiagBox, SourceFreshnessRow, CandleFreshnessBlock, type DiagLike } from './DataStatus';
import { OKX_PERP_LINE } from '@/lib/config';
import { formatPrice, formatPct, formatTs, relativeTime } from '@/lib/format';
import {
  assignSlot,
  fillSlots,
  normalizeLayout,
  toggleFavorite,
  withTier,
  LAYOUT_TIERS,
  type LayoutTier,
  type WatchLayout,
} from '@/lib/layout';
import type { FeedFreshness, FeedStatus } from '@/lib/freshness';
import type { AssetId, AssetSignal } from '@/lib/types';

interface OverviewResp {
  ok: boolean;
  status: 'live' | 'unavailable';
  generatedAt: number;
  summary: string;
  error: string | null;
  errors: string[];
  fundingProvider: 'binance' | 'okx' | null;
  freshness?: FeedFreshness | null;
  freshnessByCoin?: Record<string, FeedFreshness> | null;
  fundingTs?: Record<string, number | null> | null;
  candle?: {
    expectedLastConfirmedCloseTs: number;
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
    signals: Record<string, AssetSignal | null>;
    lastCandleTs: number | null;
    lastConfirmedTs: Record<string, number | null>;
    prices: Record<string, { last: number; ts: number } | null>;
    sources: {
      okxCandles: Record<string, DiagLike & { ok: boolean }>;
      okxTickers: DiagLike & { ok: boolean };
      funding: Record<string, DiagLike & { ok: boolean }>;
    };
  };
}

interface ConfigResp {
  ok: boolean;
  config: WatchLayout;
  notice: string | null;
  persisted: boolean;
}

interface AssetsResp {
  ok: boolean;
  candidates: { status: 'live' | 'unavailable'; total: number; sample: string[]; error: string | null; note: string };
  enabled: EnabledAsset[];
  reference: { id: string; name: string; symbol: string; instId: string }[];
}

const GRID_CLASS: Record<LayoutTier, string> = {
  4: 'grid gap-4 sm:grid-cols-2',
  6: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
  9: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3',
};

/**
 * 多标的观察盘：4/6/9 档位 → 有序卡槽 → 一币一卡渲染。
 * 布局/收藏由服务端 SQLite 持久化；补位规则见 lib/layout.ts（纯函数，可单测）。
 */
export function WatchBoard() {
  const overview = useApi<OverviewResp>('/api/market/overview');
  const configApi = useApi<ConfigResp>('/api/config');
  const assetsApi = useApi<AssetsResp>('/api/assets');

  const [config, setConfig] = useState<WatchLayout | null>(null);
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const hydrated = useRef(false);

  const persist = useCallback(async (next: WatchLayout) => {
    setConfig(next);
    setSaveState('saving');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          schemaVersion: next.schemaVersion,
          tier: next.tier,
          slots: next.slots,
          favorites: next.favorites,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok: boolean; config?: WatchLayout; errors?: string[]; error?: string }
        | null;
      if (!res.ok || !body?.ok || !body.config) {
        setSaveState('error');
        setNotice(body?.errors?.join('；') ?? body?.error ?? `保存失败（${res.status}）`);
        return;
      }
      setConfig(body.config);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      setNotice(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);

  // 首次拿到服务端配置：规范化 + 空槽确定性补位；从未持久化则落盘默认布局。
  useEffect(() => {
    if (hydrated.current || !configApi.data) return;
    hydrated.current = true;
    if (configApi.data.notice) setNotice(configApi.data.notice);
    const normalized = normalizeLayout(configApi.data.config);
    if (configApi.data.persisted) {
      setConfig(normalized);
    } else {
      const filled = fillSlots(normalized);
      void persist(filled);
    }
  }, [configApi.data, persist]);

  const enabled = assetsApi.data?.enabled ?? [];
  const enabledById = useMemo(() => new Map(enabled.map((a) => [a.id, a])), [enabled]);
  const live = overview.data?.status === 'live';
  const btc = overview.data?.data.btc;
  const sources = overview.data?.data.sources;
  const failedDiag = sources
    ? [sources.okxTickers, ...Object.values(sources.okxCandles)].find((d) => !d.ok)
    : undefined;
  const feedStatus = overview.data?.freshness?.status ?? (overview.data ? (live ? 'ok' : 'unavailable') : 'unavailable');
  const staleReason = overview.data?.freshness?.reason ?? (live ? null : (overview.data?.error ?? 'OKX 实时数据当前不可用'));
  const freshnessTs = overview.data?.freshness?.lastUpdatedTs ?? overview.data?.data.lastCandleTs ?? null;
  const coinStatus = (assetId: string): FeedStatus =>
    overview.data?.freshnessByCoin?.[assetId]?.status ?? (overview.data ? feedStatus : 'unavailable');
  const coinReason = (assetId: string): string | null | undefined =>
    overview.data?.freshnessByCoin?.[assetId]?.reason ?? (overview.data ? staleReason : undefined);

  const tier = config?.tier ?? 4;
  const usedElsewhere = useMemo(() => {
    const s = new Set<string>();
    config?.slots.forEach((id, i) => {
      if (id && i !== activeSlot) s.add(id);
    });
    return s;
  }, [config, activeSlot]);
  const activeAssetId = activeSlot != null && config ? (config.slots[activeSlot] ?? null) : null;
  const usedCount = config ? config.slots.filter(Boolean).length : 0;

  const candidateNote = assetsApi.data
    ? assetsApi.data.candidates.status === 'live'
      ? `候选池 ${assetsApi.data.candidates.total} 个 OKX 永续，均未核验，暂不可启用。`
      : `候选池暂不可拉取（${assetsApi.data.candidates.error ?? '未知原因'}）。`
    : null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">多标的观察盘 · 4H</h2>
          <div className="flex items-center gap-1 rounded-md border border-border p-0.5" role="group" aria-label="档位">
            {LAYOUT_TIERS.map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tier === t ? 'default' : 'ghost'}
                disabled={!config || overview.loading}
                onClick={() => {
                  if (!config || t === config.tier) return;
                  setNotice(null);
                  void persist(withTier(config, t));
                }}
              >
                {t} 卡
              </Button>
            ))}
          </div>
          <span className="text-[11px] text-muted-foreground">
            已用 {usedCount}/{tier} 卡槽
            {saveState === 'saving' ? ' · 保存中…' : saveState === 'saved' ? ' · 已保存' : saveState === 'error' ? ' · 保存失败' : ''}
          </span>
          <span className="text-[11px] text-muted-foreground/70">
            本地 SQLite 持久化；Vercel 生产环境不保证跨实例或跨部署保存
          </span>
        </div>
        <Button variant="outline" size="sm" onClick={overview.refresh} disabled={overview.loading}>
          {overview.loading ? '刷新中…' : '刷新'}
        </Button>
      </div>

      {notice ? (
        <div className="rounded-md border border-warn/30 bg-warn/5 px-3 py-2 text-[12px] text-warn">{notice}</div>
      ) : null}

      {overview.data ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <SourceLine provider="okx" instId={OKX_PERP_LINE} fetchedAt={overview.data.generatedAt} />
          <span>
            资金费率来源 {overview.data.fundingProvider === 'okx' ? 'OKX（Binance 不可用）' : overview.data.fundingProvider === 'binance' ? 'Binance' : '不可用'}
          </span>
          {overview.data.candle ? (
            <span>
              最近4H收盘 {formatTs(overview.data.candle.expectedLastConfirmedCloseTs)} · K线{overview.data.candle.freshnessStatus}
              {overview.data.candle.staleReason ? `（${overview.data.candle.staleReason}）` : ''}
            </span>
          ) : null}
          {feedStatus !== 'ok' && freshnessTs != null ? (
            <span className="min-w-0 break-words text-warn">数据{feedStatus === 'stale' ? '已过期' : '不可用'}：{staleReason} · 最后有效更新 {formatTs(freshnessTs)}</span>
          ) : null}
        </div>
      ) : null}

      {overview.data ? (
        <>
          <SourceFreshnessRow
            generatedAt={overview.data.generatedAt}
            lastConfirmedTs={overview.data.data.lastConfirmedTs as Record<string, number | null>}
            prices={overview.data.data.prices as Record<string, { last: number; ts: number } | null>}
            fundingTs={(overview.data.fundingTs ?? null) as Record<string, number | null> | null}
          />
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
            {config?.slots
              .filter((id): id is string => !!id)
              .map((id) => (
                <CandleFreshnessBlock
                  key={id}
                  coin={id}
                  priceTs={overview.data?.data.prices?.[id]?.ts ?? null}
                  actualOpenTs={overview.data?.data.lastConfirmedTs?.[id] ?? null}
                  now={overview.data!.generatedAt}
                />
              ))}
          </div>
        </>
      ) : null}

      {!live && !overview.loading && overview.data ? (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="flex flex-col gap-3 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">OKX 实时数据当前不可用（未使用任何快照冒充）</p>
            {overview.data.errors?.length ? (
              <ul className="list-disc space-y-1 pl-5 text-[12px]">
                {overview.data.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p>{overview.error ?? '正在拉取 OKX 实时行情…'}</p>
            )}
            <DiagBox diag={failedDiag} title="OKX 请求诊断" />
          </CardContent>
        </Card>
      ) : null}

      {btc && live ? (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">BTC 环境（OKX，仅作环境参照，不占卡槽）</CardTitle>
            <span className="text-[11px] text-muted-foreground">
              更新于 {formatTs(btc.priceTs)}（{relativeTime(btc.priceTs)}）
            </span>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <EnvStat label="BTC 价格" value={btc.price == null ? '—' : formatPrice(btc.price)} />
            <EnvStat label="近 7 日" value={formatPct(btc.return7dPct)} />
            <EnvStat label="24h 最大回撤" value={btc.maxDrawdown24hPct == null ? '—' : formatPct(btc.maxDrawdown24hPct)} />
            <EnvStat label="相对 EMA100" value={btc.closeAboveEma100 == null ? '—' : btc.closeAboveEma100 ? '上方' : '下方'} />
          </CardContent>
        </Card>
      ) : null}

      {!config ? (
        <div className={GRID_CLASS[tier]} aria-busy="true" aria-label="观察盘加载中">
          {Array.from({ length: tier }).map((_, i) => (
            <div key={i} className="min-h-[220px] space-y-2 rounded-lg border border-border/60 p-4">
              <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
              <div className="h-4 w-full animate-pulse rounded bg-muted/70" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-muted/70" />
            </div>
          ))}
        </div>
      ) : (
        <div className={GRID_CLASS[tier]}>
          {(config?.slots ?? []).map((assetId, i) => {
            const asset = assetId ? enabledById.get(assetId) : undefined;
            return (
              <div key={i} className="relative">
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>卡槽 {i + 1}</span>
                  {asset ? (
                    <div className="flex items-center gap-2">
                      <button type="button" className="hover:text-foreground" onClick={() => setActiveSlot(i)}>
                        更换
                      </button>
                      <button
                        type="button"
                        className="hover:text-foreground"
                        onClick={() => {
                          if (!config) return;
                          const r = assignSlot(config, i, null);
                          void persist(r.layout);
                        }}
                      >
                        移除
                      </button>
                    </div>
                  ) : null}
                </div>
                {asset ? (
                  <SignalCard
                    asset={asset.id as AssetId}
                    signal={overview.data?.data.signals?.[asset.id] ?? null}
                    loading={overview.loading && !overview.data}
                    price={overview.data?.data.prices?.[asset.id]?.last ?? null}
                    priceTs={overview.data?.data.prices?.[asset.id]?.ts ?? null}
                    dataStatus={overview.data ? coinStatus(asset.id) : undefined}
                    staleReason={overview.data ? coinReason(asset.id) : undefined}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setActiveSlot(i)}
                    className="flex min-h-[220px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 bg-muted/10 text-sm text-muted-foreground transition-colors hover:border-radar/50 hover:text-foreground"
                  >
                    <span className="text-lg">＋</span>
                    <span>空槽 {i + 1}</span>
                    <span className="text-[11px]">选择标的</span>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeSlot != null && config ? (
        <AssetPicker
          assets={enabled}
          favorites={config.favorites}
          usedElsewhere={usedElsewhere}
          activeAssetId={activeAssetId}
          candidateNote={candidateNote}
          onSelect={(assetId) => {
            const r = assignSlot(config, activeSlot, assetId);
            if (r.error) {
              setNotice(r.error);
              return;
            }
            setNotice(null);
            void persist(r.layout);
            setActiveSlot(null);
          }}
          onToggleFavorite={(assetId) => {
            void persist(toggleFavorite(config, assetId));
          }}
          onClose={() => setActiveSlot(null)}
        />
      ) : null}
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
