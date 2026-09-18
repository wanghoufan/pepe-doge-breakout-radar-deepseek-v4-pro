'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** /api/assets 返回的已启用标的（选择器唯一可选集合）。 */
export interface EnabledAsset {
  id: string;
  name: string;
  symbol: string;
  instId: string;
  status: string;
  statusLabel: string;
  hasHistoryBaseline: boolean;
  themecolor: string;
}

/** /api/assets 返回的候选标的（未启用，需逐币核验后方可放入卡槽）。 */
export interface CandidateAsset {
  id: string;
  name: string;
  symbol: string;
  instId: string;
  status: string;
  statusLabel: string;
  verified: boolean;
  enabled: boolean;
  hasHistoryBaseline: boolean;
  themecolor: string;
  verifiedAt: number | null;
  evidence: string | null;
}

export interface VerifyUiState {
  status: 'idle' | 'loading' | 'error';
  reason?: string;
}

/** 无搜索词时最多渲染的候选行数（搜索可缩小范围；避免一次铺 400+ 行）。 */
const MAX_CANDIDATES_SHOWN = 60;

/**
 * 标的选择器：按名称/代码搜索 + 收藏 + 选中。
 * - 「已启用」：可放入卡槽；已被其他卡槽占用的禁用（一币一卡）。
 * - 「候选」：来自 OKX 永续目录、尚未核验；提供「核验并启用」，失败逐项展示原因。
 * 文案不输出任何胜率/收益表述。
 */
export function AssetPicker({
  assets,
  candidates,
  favorites,
  usedElsewhere,
  activeAssetId,
  candidateNote,
  verifyState,
  onSelect,
  onToggleFavorite,
  onVerify,
  onClose,
}: {
  assets: EnabledAsset[];
  candidates?: CandidateAsset[];
  favorites: string[];
  /** 已被其他卡槽占用的标的 id。 */
  usedElsewhere: Set<string>;
  /** 当前卡槽已绑定的标的 id。 */
  activeAssetId: string | null;
  candidateNote?: string | null;
  verifyState?: Record<string, VerifyUiState>;
  onSelect: (assetId: string | null) => void;
  onToggleFavorite: (assetId: string) => void;
  onVerify?: (assetId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const q = query.trim().toLowerCase();
  const match = (a: { id: string; name: string; symbol: string }) =>
    !q || a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q);

  const filteredEnabled = assets.filter(match).sort((a, b) => {
    const fa = favSet.has(a.id) ? 0 : 1;
    const fb = favSet.has(b.id) ? 0 : 1;
    return fa - fb || a.id.localeCompare(b.id);
  });

  const candidatePool = (candidates ?? []).filter((c) => !c.enabled && match(c));
  const shownCandidates = q ? candidatePool : candidatePool.slice(0, MAX_CANDIDATES_SHOWN);
  const hiddenCandidateCount = candidatePool.length - shownCandidates.length;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 p-4 pt-16 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="选择标的">
      <div className="w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-semibold">选择标的</div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="关闭选择器">
            关闭
          </Button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索名称或代码（如 HYPE / XMR）"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-radar"
            aria-label="搜索标的"
          />
          {candidateNote ? <p className="text-[11px] text-muted-foreground">{candidateNote}</p> : null}

          <div className="max-h-80 space-y-3 overflow-y-auto">
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                已启用（{filteredEnabled.length}）
              </div>
              {filteredEnabled.map((a) => {
                const used = usedElsewhere.has(a.id);
                const active = activeAssetId === a.id;
                return (
                  <div
                    key={a.id}
                    className={cn(
                      'flex items-center gap-2 rounded-md border px-2.5 py-2',
                      active ? 'border-radar/40 bg-radar/10' : 'border-border/60',
                      used && !active ? 'opacity-50' : '',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleFavorite(a.id)}
                      aria-label={favSet.has(a.id) ? `取消收藏 ${a.symbol}` : `收藏 ${a.symbol}`}
                      className={cn('shrink-0 text-base leading-none', favSet.has(a.id) ? 'text-warn' : 'text-muted-foreground')}
                    >
                      {favSet.has(a.id) ? '★' : '☆'}
                    </button>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.themecolor }} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm">{a.symbol}</span>
                        {!a.hasHistoryBaseline && (
                          <span className="rounded border border-border/60 px-1 text-[10px] text-muted-foreground">无研究基线</span>
                        )}
                      </div>
                      <div className="truncate text-[11px] text-muted-foreground">{a.instId}</div>
                    </div>
                    <Button
                      size="sm"
                      variant={active ? 'default' : 'outline'}
                      disabled={used && !active}
                      onClick={() => onSelect(active ? null : a.id)}
                    >
                      {active ? '移除' : used ? '已占用' : '放入'}
                    </Button>
                  </div>
                );
              })}
              {filteredEnabled.length === 0 && (
                <div className="py-3 text-center text-[12px] text-muted-foreground">无匹配的已启用标的</div>
              )}
            </div>

            <div className="space-y-1 border-t border-border/60 pt-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                候选 · 待核验（{candidatePool.length}）
              </div>
              {shownCandidates.map((c) => {
                const vs = verifyState?.[c.id];
                const loading = vs?.status === 'loading';
                return (
                  <div key={c.id} className="rounded-md border border-border/60 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.themecolor }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{c.symbol}</span>
                          <span className="rounded border border-border/60 px-1 text-[10px] text-muted-foreground">
                            {c.verified ? '已核验' : c.statusLabel}
                          </span>
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{c.instId}</div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={loading || !onVerify}
                        onClick={() => onVerify?.(c.id)}
                      >
                        {loading ? '核验中…' : '核验并启用'}
                      </Button>
                    </div>
                    {vs?.status === 'error' && vs.reason ? (
                      <p className="mt-1.5 rounded border border-bear/30 bg-bear/5 px-2 py-1 text-[11px] text-bear">
                        未通过：{vs.reason}
                      </p>
                    ) : null}
                  </div>
                );
              })}
              {candidatePool.length === 0 && (
                <div className="py-3 text-center text-[12px] text-muted-foreground">无匹配的候选标的</div>
              )}
              {hiddenCandidateCount > 0 ? (
                <div className="py-1 text-center text-[11px] text-muted-foreground">
                  还有 {hiddenCandidateCount} 个候选，请输入名称/代码搜索
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
