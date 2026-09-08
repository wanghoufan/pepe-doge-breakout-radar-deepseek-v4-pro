import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CandleChart, type ChartMarker } from '@/components/market/CandleChart';
import {
  getHistoricalEventById,
  getEventCandles,
  getEventBtcCandles,
} from '@/lib/data-store';
import { ASSETS } from '@/lib/config';
import { formatDate, formatTs, formatPct, formatRatio, formatPrice } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const e = getHistoricalEventById(id);
  return { title: e ? `样本 ${e.id}` : '未找到样本' };
}

export default async function HistoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const event = getHistoricalEventById(id);
  if (!event) notFound();

  const meta = ASSETS[event.coin];
  const candles = getEventCandles(event, event.coin);
  const btcCandles = getEventBtcCandles(event);

  const markers: ChartMarker[] = [
    { ts: event.startTs, label: '启动', kind: 'event' },
    ...(event.breakoutTs ? [{ ts: event.breakoutTs, label: '突破', kind: 'breakout' as const }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link href="/history" className="hover:text-radar">
          历史样本
        </Link>
        <span>/</span>
        <span className="tnum font-mono text-foreground">{event.id}</span>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="tnum font-mono text-2xl font-semibold">{event.id}</h1>
            <Badge variant="outline" style={{ color: meta.themecolor, borderColor: `${meta.themecolor}55` }}>
              {meta.symbol}
            </Badge>
            {event.campaignLabel && (
              <Badge variant="secondary">
                {event.campaignId} · {event.campaignLabel}
              </Badge>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatDate(event.startTs)} 启动 · {formatDate(event.endTs)} 结束
          </p>
        </div>
        <Link
          href="/methodology"
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          查看口径说明
        </Link>
      </header>

      {/* 启动前画像 + 启动后结果 */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">启动前画像（蓄势窗口）</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Metric label="启动前收益" value={formatPct(event.preReturnPct)} />
            <Metric label="启动前波动（ATR）" value={event.preAtrPct.toFixed(2) + '%'} />
            <Metric label="ATR 收缩比" value={event.compressionRatio.toFixed(2)} sub="越小越收缩" />
            <Metric label="量能收缩比" value={event.preVolumeRatio.toFixed(2)} sub="<1 缩量" />
            <Metric label="站上 EMA20" value={event.startAboveEma20 ? '是' : '否'} />
            <Metric label="EMA 多头排列" value={event.emaBullishStack ? '是' : '否'} />
            <Metric label="启动前费率均值" value={event.preFundingAvgPct == null ? '—' : event.preFundingAvgPct.toFixed(4) + '%'} />
            <Metric label="启动前费率峰值" value={event.preFundingMaxPct == null ? '—' : event.preFundingMaxPct.toFixed(4) + '%'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">突破与跟随（V2 · 从 breakoutTs 起算）</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Metric label="突破时点" value={event.breakoutTs ? formatTs(event.breakoutTs) : '未发生'} />
            <Metric label="突破延迟" value={event.breakoutDelayHours == null ? '—' : event.breakoutDelayHours.toFixed(0) + ' h'} />
            <Metric label="突破位" value={formatPrice(event.breakoutLevel)} />
            <Metric label="突破收盘" value={formatPrice(event.breakoutClose)} />
            <Metric label="突破当根超越幅度" value={formatPct(event.breakoutDistancePct)} />
            <Metric label="突破量比" value={event.breakoutVolRatio == null ? '—' : formatRatio(event.breakoutVolRatio, 1)} />
            <Metric label="突破后 24h 量比" value={event.followThrough24hVolRatio == null ? '—' : formatRatio(event.followThrough24hVolRatio, 1)} />
            <Metric label="突破后 48h 量比" value={event.followThrough48hVolRatio == null ? '—' : formatRatio(event.followThrough48hVolRatio, 1)} />
            <Metric label="相对 BTC 24h" value={formatPct(event.relativeReturn24h)} />
            <Metric label="相对 BTC 72h" value={formatPct(event.relativeReturn72h)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">MFE / MAE（突破后表现，相对突破收盘）</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Metric label="MFE 24h" value={formatPct(event.mfe24h, 1)} />
            <Metric label="MAE 24h" value={formatPct(event.mae24h, 1)} />
            <Metric label="MFE 48h" value={formatPct(event.mfe48h, 1)} />
            <Metric label="MAE 48h" value={formatPct(event.mae48h, 1)} />
            <Metric label="MFE 72h" value={formatPct(event.mfe72h, 1)} />
            <Metric label="MAE 72h" value={formatPct(event.mae72h, 1)} />
            <Metric label="MFE 7D" value={formatPct(event.mfe7d, 1)} />
            <Metric label="MAE 7D" value={formatPct(event.mae7d, 1)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">事后完整波段（Hindsight，仅描述，非策略收益）</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Metric label="区间最低 → 最高" value={formatPct(event.coinPeakReturn, 1)} />
            <Metric label="区间峰值回撤" value={formatPct(event.eventMaxDrawdown, 1)} />
            <Metric label="事件期费率过热占比" value={event.eventFundingOverheatRate == null ? '—' : (event.eventFundingOverheatRate * 100).toFixed(0) + '%'} />
            <Metric label="事后标签" value={event.outcome ? (event.outcome === 'success' ? '成功' : event.outcome === 'failure' ? '失败' : '普通') : '未标注'} />
          </CardContent>
        </Card>
      </div>

      {/* BTC 环境对照 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">BTC 环境对照（同期）</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Metric label="BTC 同期收益" value={formatPct(event.btcReturnPct)} />
          <Metric label="BTC 峰值涨幅" value={formatPct(event.btcPeakReturnPct)} />
          <Metric label="BTC 峰值回撤" value={formatPct(event.btcMaxDrawdown)} />
          <Metric label="币相对 BTC 72h" value={formatPct(event.relativeReturn72h)} />
        </CardContent>
      </Card>

      {/* 图表 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            {meta.symbol} 4H K 线 · 启动前 10 日 ~ 事件窗口
          </CardTitle>
        </CardHeader>
        <CardContent>
          {candles.length ? (
            <CandleChart candles={candles} markers={markers} showEma />
          ) : (
            <div className="py-10 text-center text-sm text-muted-foreground">暂无该窗口 K 线快照</div>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            橙色虚线为事件启动时点、突破标注；BTC 对照曲线 {btcCandles.length} 根 K 线（用于环境判断，未并入上图坐标）。
          </p>
        </CardContent>
      </Card>

      {/* 截图 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">原始截图证据</CardTitle>
        </CardHeader>
        <CardContent>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={event.screenshot}
            alt={`${event.id} 原始截图`}
            className="w-full rounded-lg border border-border/60"
            loading="lazy"
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            来源：资料包《01_原始截图》，与量化数据共同构成该事件的可复核证据。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="tnum mt-0.5 font-mono text-sm text-foreground">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70">{sub}</div>}
    </div>
  );
}