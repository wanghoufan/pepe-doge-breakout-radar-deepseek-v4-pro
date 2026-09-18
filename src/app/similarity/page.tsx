import type { Metadata } from 'next';
import { SimilarityView } from '@/components/market/SimilarityView';
import { getHistoricalEvents } from '@/lib/data-store';
import { getEnabledAssets } from '@/lib/registry';
import { getServerRegistry } from '@/lib/server/registry-service';

export const metadata: Metadata = {
  title: '形态相似性 · PEPE/DOGE/ETHFI 突破雷达',
  description: '基于启动前特征的 21 个历史突破事件形态相似性分析。',
};

export const dynamic = 'force-dynamic';

export default function SimilarityPage() {
  const events = getHistoricalEvents();
  const coins = getEnabledAssets(getServerRegistry()).map((a) => ({
    id: a.id,
    symbol: a.symbol,
    hasBaseline: a.hasHistoryBaseline && events.some((e) => e.coin === a.id),
  }));
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <SimilarityView coins={coins} />
    </div>
  );
}
