import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AssetDetail } from '@/components/market/AssetDetail';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHistoricalEvents } from '@/lib/data-store';
import { findEnabledAsset } from '@/lib/registry';
import { getServerRegistry, resolveEnabledAssetJIT } from '@/lib/server/registry-service';
import { getMarketOverview } from '@/lib/market-service';
import { formatDate, formatPct } from '@/lib/format';

/** seed 三币保留静态参数；其余已启用标的按请求动态渲染（force-dynamic）。 */
export function generateStaticParams() {
  return [{ coin: 'pepe' }, { coin: 'doge' }, { coin: 'ethfi' }];
}

/** 已启用标的会随核验落库变化，读服务端注册表，不做静态缓存。 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ coin: string }>;
}): Promise<Metadata> {
  const { coin } = await params;
  const upper = coin.toUpperCase();
  const asset = findEnabledAsset(upper, getServerRegistry());
  const symbol = asset?.symbol ?? upper;
  return {
    title: `${symbol} 突破雷达`,
    description: `${symbol} 蓄势/突破/过热/失效 六阶段状态雷达与历史典型形态。`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ coin: string }> }) {
  const { coin } = await params;
  const upper = coin.toUpperCase();
  // 有效集合 = seed 三币 + 服务端已启用标的；未启用候选走 JIT 即时核验
  //（多实例 /tmp 不共享，页面不依赖访问亲和性）；未知/核验不过一律 404。
  let asset = findEnabledAsset(upper, getServerRegistry());
  if (!asset) asset = await resolveEnabledAssetJIT(upper);
  if (!asset) notFound();

  const meta = { symbol: asset.symbol, themecolor: asset.themecolor, hasHistoryBaseline: asset.hasHistoryBaseline };
  const events = getHistoricalEvents().filter((e) => e.coin === asset.id).sort((a, b) => b.startTs - a.startTs);
  const hasBaseline = asset.hasHistoryBaseline && events.length > 0;

  // 服务端直出本标信号初值：同请求同实例，JIT 核验落库立即可见，
  // 客户端 overview 刷新若落到无记录实例则沿用初值（不闪断为不可用）。
  const overview = await getMarketOverview(getServerRegistry());
  const initial = {
    signal: overview.signals[asset.id] ?? null,
    price: overview.prices[asset.id] ?? null,
    freshness: overview.freshnessByCoin[asset.id] ?? null,
    live: overview.status === 'live',
    generatedAt: overview.generatedAt,
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <AssetDetail coin={asset.id} meta={meta} initial={initial} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">该币种历史典型形态（{events.length}）</h2>
        {!hasBaseline && (
          <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
            {asset.symbol} 暂无历史基线样本（21 个历史事件为 PEPE 11 + DOGE 10），相似性与研究指标未知/缺失，禁编造。本页仅展示实时信号。
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((e) => (
            <Link key={e.id} href={`/history/${e.id}`}>
              <Card className="h-full transition-colors hover:border-radar/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <span className="font-mono">{e.id}</span>
                    <span className="text-xs font-normal text-muted-foreground">{formatDate(e.startTs)}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-3 gap-2 text-xs">
                  <Stat label="准备涨幅" value={formatPct(e.preReturnPct, 0)} />
                  <Stat label="峰值涨幅" value={formatPct(e.coinPeakReturn, 0)} />
                  <Stat label="峰值回撤" value={formatPct(e.eventMaxDrawdown, 0)} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="tnum font-mono">{value}</div>
    </div>
  );
}
