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

/**
 * 标的选择器：按名称/代码搜索 + 收藏 + 选中。
 * 只列出 enabled 标的；已被其他卡槽占用的禁用（一币一卡）；
 * 候选池标的（未核验）不出现，仅在选择器顶部展示计数说明。
 */
export function AssetPicker({
  assets,
  favorites,
  usedElsewhere,
  activeAssetId,
  candidateNote,
  onSelect,
  onToggleFavorite,
  onClose,
}: {
  assets: EnabledAsset[];
  favorites: string[];
  /** 已被其他卡槽占用的标的 id。 */
  usedElsewhere: Set<string>;
  /** 当前卡槽已绑定的标的 id。 */
  activeAssetId: string | null;
  candidateNote?: string | null;
  onSelect: (assetId: string | null) => void;
  onToggleFavorite: (assetId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const q = query.trim().toLowerCase();
  const filtered = assets
    .filter((a) => !q || a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.symbol.toLowerCase().includes(q))
    .sort((a, b) => {
      const fa = favSet.has(a.id) ? 0 : 1;
      const fb = favSet.has(b.id) ? 0 : 1;
      return fa - fb || a.id.localeCompare(b.id);
    });

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
            placeholder="搜索名称或代码（如 PEPE / eth）"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-radar"
            aria-label="搜索标的"
          />
          {candidateNote ? <p className="text-[11px] text-muted-foreground">{candidateNote}</p> : null}

          <ul className="max-h-80 space-y-1 overflow-y-auto">
            {filtered.map((a) => {
              const used = usedElsewhere.has(a.id);
              const active = activeAssetId === a.id;
              return (
                <li key={a.id}>
                  <div
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
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="py-6 text-center text-sm text-muted-foreground">无匹配的已启用标的</li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}
