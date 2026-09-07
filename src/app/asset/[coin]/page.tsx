import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AssetDetail } from '@/components/market/AssetDetail';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getHistoricalEvents } from '@/lib/data-store';
import { ASSETS } from '@/lib/config';
import { formatDate, formatPct } from '@/lib/format';

const VALID = ['PEPE', 'DOGE'] as const;
type Coin = (typeof VALID)[number];

export function generateStaticParams() {
  return [{ coin: 'pepe' }, { coin: 'doge' }];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ coin: string }>;
}): Promise<Metadata> {
  const { coin } = await params;
  const upper = coin.toUpperCase();
  const meta = ASSETS[upper as keyof typeof ASSETS];
  return {
    title: `${meta?.symbol ?? upper} 突破雷达`,
    description: `${meta?.symbol ?? upper} 蓄势/突破/过热/失效 六阶段状态雷达与历史典型形态。`,
  };
}

export default async function AssetPage({ params }: { params: Promise<{ coin: string }> }) {
  const { coin } = await params;
  const upper = coin.toUpperCase() as Coin;
  if (!VALID.includes(upper)) notFound();

  const meta = ASSETS[upper];
  const events = getHistoricalEvents().filter((e) => e.coin === upper).sort((a, b) => b.startTs - a.startTs);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <AssetDetail coin={upper} />

      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">该币种历史典型形态（{events.length}）</h2>
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