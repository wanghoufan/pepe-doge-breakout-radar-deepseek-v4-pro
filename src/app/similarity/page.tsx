import type { Metadata } from 'next';
import { SimilarityView } from '@/components/market/SimilarityView';

export const metadata: Metadata = {
  title: '形态相似性 · PEPE/DOGE 突破雷达',
  description: '基于启动前特征的 21 个历史突破事件形态相似性分析。',
};

export default function SimilarityPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <SimilarityView />
    </div>
  );
}