import type { Metadata } from 'next';
import { HistoryGrid } from '@/components/market/HistoryGrid';
import { getHistoricalEvents } from '@/lib/data-store';
import { getEnabledAssets } from '@/lib/registry';
import { getServerRegistry } from '@/lib/server/registry-service';

export const metadata: Metadata = { title: '历史样本' };

export const dynamic = 'force-dynamic';

export default function HistoryPage() {
  const events = getHistoricalEvents();
  const coins = getEnabledAssets(getServerRegistry()).map((a) => ({
    id: a.id,
    symbol: a.symbol,
    hasBaseline: a.hasHistoryBaseline && events.some((e) => e.coin === a.id),
  }));
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">历史样本库</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          21 个已挑选的历史上涨行情波段（PEPE 11 个、DOGE 10 个），每个样本都附带启动前量价、
          突破量比、资金费率与 BTC 环境等可复核指标。点击卡片查看完整证据与原始截图。
        </p>
      </header>
      <HistoryGrid events={events} coins={coins} />
    </div>
  );
}
