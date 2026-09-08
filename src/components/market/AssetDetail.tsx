'use client';

import { useState } from 'react';
import { useApi } from '@/hooks/use-api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StateBadge } from '@/components/market/StateBadge';
import { ActionCard } from '@/components/market/ActionCard';
import { CandleChart } from '@/components/market/CandleChart';
import { SourceLine, DiagBox, SourceFreshnessRow, CandleFreshnessBlock, type DiagLike } from '@/components/market/DataStatus';
import type { Candle, AssetSignal, Timeframe } from '@/lib/types';
import type { FeedFreshness } from '@/lib/freshness';
import { ASSETS } from '@/lib/config';
import {
  deriveActionState,
  actionInputFromSignal,
  ENTRY_HEAT_COPY,
  SETUP_COPY,
  TRIGGER_COPY,
  FOLLOW_THROUGH_COPY,
} from '@/lib/action';
import { formatPrice, formatPct, formatTs, formatClock, relativeTime } from '@/lib/format';
import { CANDLE_4H_MS } from '@/lib/time';
import { cn } from '@/lib/utils';

interface CandlesResp {
  ok: boolean;
  source: 'live' | 'unavailable';
  provider?: string;
  fetchedAt?: number;
  error?: string;
  message?: string;
  diag?: DiagLike;
  data: {
    instId: string;
    bar: string;
    candles: Candle[];
    confirmedCandles: Candle[];
    intradayCandle: Candle | null;
    lastConfirmedTs: number | null;
  };
}

interface FundingResp {
  ok: boolean;
  source: 'live' | 'unavailable';
  provider?: string;
  degraded?: boolean;
  note?: string;
  fetchedAt?: number;
  error?: string;
  message?: string;
  diag?: DiagLike;
  data: { symbol: string; points: { ts: number; rate: number }[] };
}

interface OverviewResp {
  ok: boolean;
  status: 'live' | 'unavailable';
  generatedAt: number;
  summary: string;
  error: string | null;
  errors?: string[];
  fundingProvider?: 'binance' | 'okx' | null;
  freshness?: FeedFreshness | null;
  fundingTs?: Record<'PEPE' | 'DOGE', number | null> | null;
  data: {
    pepe: AssetSignal | null;
    doge: AssetSignal | null;
    prices: Record<'PEPE' | 'DOGE' | 'BTC', { last: number; ts: number } | null>;
    lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
    intraday: { PEPE: Candle | null; DOGE: Candle | null; BTC: Candle | null };
    sources: Record<string, unknown>;
  };
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
  const price = overviewApi.data?.data.prices?.[coin] ?? null;
  // P0-1 三态：优先用服务端 freshness；缺字段时按 live 回退（此前非 live 硬编码 'stale'，现按 unavailable 回退）。
  const feedStatus = overviewApi.data?.freshness?.status ?? (overviewApi.data ? (live ? 'ok' : 'unavailable') : 'unavailable');
  const feedReason =
    overviewApi.data?.freshness?.reason ?? (live ? null : '实时链路非 live，信号可能不是最新');
  const action = signal
    ? deriveActionState(
        actionInputFromSignal(signal, {
          asset: coin,
          price: price?.last ?? null,
          priceTs: price?.ts ?? null,
          forcedStatus: feedStatus,
          staleReason: feedReason,
        }),
      )
    : deriveActionState(
        actionInputFromSignal(null, {
          asset: coin,
          price: price?.last ?? null,
          priceTs: price?.ts ?? null,
        }),
      );

  const candles = candlesApi.data?.data.candles ?? [];
  const lastConfirmedTs = candlesApi.data?.data.lastConfirmedTs ?? null;
  const intraday = candlesApi.data?.data.intradayCandle ?? null;
  const instId = candlesApi.data?.data.instId ?? `${coin}-USDT-SWAP`;

  const funding = fundingApi.data?.data.points ?? [];
  const fundingAvg = funding.length ? (funding.reduce((s, r) => s + r.rate, 0) / funding.length) * 100 : null;
  const fundingMax = funding.length ? Math.max(...funding.map((r) => r.rate)) * 100 : null;

  const refreshAll = () => {
    candlesApi.refresh();
    fundingApi.refresh();
    overviewApi.refresh();
  };

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold" style={{ color: meta.themecolor }}>
            {meta.symbol}
          </h1>
          <span className="text-sm text-muted-foreground">突破雷达 · OKX 永续 4H 口径</span>
        </div>
        <div className="flex items-center gap-2">
          {signal ? <StateBadge state={signal.state} /> : null}
          <Button variant="outline" size="sm" onClick={refreshAll}>
            刷新
          </Button>
        </div>
      </header>

      {/* 数据来源与更新时间 */}
      <Card>
        <CardContent className="space-y-2 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SourceLine
              provider={candlesApi.data?.provider ?? 'okx'}
              instId={instId}
              fetchedAt={price?.ts ?? candlesApi.data?.fetchedAt ?? null}
              label={live ? '实时' : '不可用'}
            />
            <div className="text-sm">
              <span className="text-muted-foreground">最新价 </span>
              <span className="tnum font-mono font-medium">{formatPrice(price?.last ?? null)}</span>
              {price?.ts ? (
                <span className="ml-2 text-[11px] text-muted-foreground">
                  更新于 {formatTs(price.ts)}（{relativeTime(price.ts)}）
                </span>
              ) : null}
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            K 线：{candlesApi.data ? `OKX ${instId} ${tf}` : '请求中…'}
            {/* Phase A：open 语义输入，close 口径展示（禁止 openTs 直算）。 */}
            {lastConfirmedTs ? ` · 最近4H收盘 ${formatTs(lastConfirmedTs + CANDLE_4H_MS)}（区间 ${formatClock(lastConfirmedTs)}–${formatClock(lastConfirmedTs + CANDLE_4H_MS)}）` : ''}
            {intraday ? (
              <span className="ml-1 text-warn">
                · 盘中未收盘 {formatPrice(intraday.c)}（不构成突破确认）
              </span>
            ) : null}
          </div>
          {candlesApi.data && !candlesApi.data.ok ? (
            <DiagBox diag={candlesApi.data.diag} title={candlesApi.data.message ?? 'K 线实时接口不可用'} />
          ) : null}
          {overviewApi.data && (
            <SourceFreshnessRow
              generatedAt={overviewApi.data.generatedAt}
              lastConfirmedTs={overviewApi.data.data.lastConfirmedTs}
              prices={overviewApi.data.data.prices}
              fundingTs={overviewApi.data.fundingTs ?? null}
            />
          )}
          {/* Phase A：现价与 K 线新鲜度分离显示（三行，全站统一口径）。 */}
          {overviewApi.data && (
            <CandleFreshnessBlock
              coin={coin}
              priceTs={price?.ts ?? null}
              actualOpenTs={overviewApi.data.data.lastConfirmedTs[coin]}
              now={overviewApi.data.generatedAt}
            />
          )}
        </CardContent>
      </Card>

      {/* 当前行动（Level 1–3，永远在最前） */}
      <ActionCard action={action} />

      {/* 评分（分层，Level 5；失效后历史评分灰化，仅复盘） */}
      {signal && (
        <Card>
          <CardContent className="space-y-3 py-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">BTC 环境</span>
                <span
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs font-medium',
                    signal.environment.gate === 'ALLOW'
                      ? 'border-radar/30 bg-radar/10 text-radar'
                      : signal.environment.gate === 'CAUTION'
                        ? 'border-warn/30 bg-warn/10 text-warn'
                        : 'border-bear/30 bg-bear/10 text-bear',
                  )}
                >
                  {signal.environment.gate}
                </span>
              </div>
              {signal.hardVeto.kind !== 'NONE' && (
                <div className="rounded-md border border-bear/30 bg-bear/10 px-3 py-1.5 text-xs text-bear">
                  ⚠ 硬否决（{signal.hardVeto.kind}）：{signal.hardVeto.reason}
                </div>
              )}
            </div>
            <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-4', action.history.historicalOnly && 'opacity-50 grayscale')}>
              <ScoreBox label="Setup 蓄势" value={signal.setup.value} status={signal.setup.status} color={meta.themecolor} tooltip={SETUP_COPY.tooltip} />
              <ScoreBox label="Trigger 突破结构" value={signal.trigger.value} status={signal.trigger.status} color='var(--btc)' tooltip={TRIGGER_COPY.tooltip} />
              <ScoreBox label="Follow 跟随" value={signal.followThrough.value} status={signal.followThrough.status} color='var(--radar)' tooltip={FOLLOW_THROUGH_COPY.tooltip} displayValue={action.history.followThroughText} />
              <ScoreBox label="Entry Heat 追高/过热" value={action.entryHeat.value} status={action.entryHeat.value != null ? 'COMPUTED' : 'DATA_UNAVAILABLE'} color='var(--bear)' tooltip={ENTRY_HEAT_COPY.tooltip} displayValue={action.entryHeat.value != null ? `${action.entryHeat.value} · ${action.entryHeat.band}` : undefined} />
            </div>
            {action.history.historicalOnly && (
              <p className="text-[11px] text-muted-foreground">本轮历史突破评分，仅用于复盘。</p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Level label="当前下一压力" value={formatPrice(signal.keyLevels.resistance)} />
              <Level label="结构失效位" value={formatPrice(signal.keyLevels.invalidation)} />
              <Level label="本轮突破位" value={formatPrice(signal.keyLevels.breakoutLevel)} />
              <Level label="EMA20" value={formatPrice(signal.keyLevels.ema20)} />
            </div>
          </CardContent>
        </Card>
      )}

      {!signal && !overviewApi.loading && (
        <Card className="border-warn/30 bg-warn/5">
          <CardContent className="space-y-2 py-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">实时信号不可用（未使用任何快照冒充）</p>
            {overviewApi.data?.errors?.length ? (
              <ul className="list-disc space-y-1 pl-5 text-[12px]">
                {overviewApi.data.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            ) : (
              <p>{overviewApi.error ?? overviewApi.data?.error ?? '未知原因'}</p>
            )}
            <p className="text-[11px]">
              仅当 OKX 返回「已收盘」4H K 线时才会给出突破判定；盘中未收盘 K 线只作展示。
            </p>
          </CardContent>
        </Card>
      )}

      {/* 图表 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
            价格与量能
            {candlesApi.data?.ok ? (
              <span className="text-[11px] font-normal text-radar">实时 · OKX</span>
            ) : (
              <span className="text-[11px] font-normal text-warn">实时不可用</span>
            )}
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
            <div className="space-y-3 py-8">
              <div className="text-center text-sm text-muted-foreground">
                {candlesApi.error ?? candlesApi.data?.message ?? '实时数据不可用'}
              </div>
              <DiagBox diag={candlesApi.data?.diag} />
            </div>
          )}
          {lastConfirmedTs && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              最近4H收盘：{formatTs(lastConfirmedTs + CANDLE_4H_MS)}（区间 {formatClock(lastConfirmedTs)}–{formatClock(lastConfirmedTs + CANDLE_4H_MS)}，UTC+8）
              {intraday ? `　盘中未收盘：${formatPrice(intraday.c)}（不参与判定）` : ''}
            </p>
          )}
        </CardContent>
      </Card>

      {/* 资金费率 + 证据 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
              资金费率
              <span className="text-[11px] font-normal text-muted-foreground">
                {fundingApi.data?.ok
                  ? `来源 ${fundingApi.data.provider === 'okx' ? 'OKX' : 'Binance'}`
                  : '不可用'}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
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
            {fundingApi.data?.ok ? (
              <p className="text-[11px] text-muted-foreground">
                更新于 {formatTs(fundingApi.data.fetchedAt ?? null)}
                {fundingApi.data.note ? ` · ${fundingApi.data.note}` : ''}
              </p>
            ) : (
              <DiagBox diag={fundingApi.data?.diag} title={fundingApi.data?.message ?? fundingApi.error ?? '资金费率不可用'} />
            )}
            <p className="text-[11px] text-muted-foreground">
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
                {[...signal.setupConditions, ...signal.triggerConditions, ...signal.followThroughConditions]
                  .filter((c) => c.met)
                  .slice(0, 8)
                  .map((c) => (
                    <div key={c.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="text-radar">✓</span>
                      <span className="truncate">{c.label}</span>
                    </div>
                  ))}
                {[...signal.setupConditions, ...signal.triggerConditions, ...signal.followThroughConditions]
                  .filter((c) => !c.met && !c.unknown)
                  .slice(0, 4)
                  .map((c) => (
                    <div key={c.key} className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                      <span className="text-muted-foreground">○</span>
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
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-muted/50 px-3 py-1.5">
      <span className="min-w-0 text-xs text-muted-foreground">{label}</span>
      <span className="tnum max-w-[60%] shrink-0 break-all text-right font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

const SCORE_STATUS_LABEL: Record<'COMPUTED' | 'WAITING' | 'PENDING' | 'NOT_STARTED' | 'DATA_UNAVAILABLE', string> = {
  COMPUTED: '',
  WAITING: '等待触发',
  PENDING: '待补齐',
  NOT_STARTED: '未开始',
  DATA_UNAVAILABLE: '不可用',
};

function ScoreBox({
  label,
  value,
  status,
  color,
  tooltip,
  displayValue,
}: {
  label: string;
  value: number | null;
  status: 'COMPUTED' | 'WAITING' | 'PENDING' | 'NOT_STARTED' | 'DATA_UNAVAILABLE';
  color: string;
  tooltip?: string;
  displayValue?: string;
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <div className="text-[11px] text-muted-foreground" title={tooltip}>
        {label}
      </div>
      <div className="tnum mt-0.5 font-mono text-lg font-semibold" style={{ color }}>
        {status === 'COMPUTED' && value != null ? (displayValue ?? value) : SCORE_STATUS_LABEL[status]}
      </div>
    </div>
  );
}
