'use client';

import { formatPricePlain, formatPct, formatTs } from '@/lib/format';
import type { ActionState } from '@/lib/action';
import { cn } from '@/lib/utils';

const SEVERITY: Record<ActionState['severity'], { border: string; bg: string; text: string }> = {
  danger: { border: 'border-bear/40', bg: 'bg-bear/10', text: 'text-bear' },
  warn: { border: 'border-warn/40', bg: 'bg-warn/10', text: 'text-warn' },
  ok: { border: 'border-radar/40', bg: 'bg-radar/10', text: 'text-radar' },
  info: { border: 'border-btc/40', bg: 'bg-btc/10', text: 'text-btc' },
  muted: { border: 'border-border', bg: 'bg-muted/40', text: 'text-muted-foreground' },
  dark: { border: 'border-border', bg: 'bg-muted/60', text: 'text-foreground' },
};

/**
 * 当前行动卡（Level 1–3：行动 / 关键价格 / 为什么与接下来观察）。
 * 纯展示：所有判定来自 deriveActionState()，组件内无 if/else 策略逻辑。
 */
export function ActionCard({ action }: { action: ActionState }) {
  const s = SEVERITY[action.severity];
  const k = action.keyLevels;
  return (
    <div className={cn('space-y-3 rounded-lg border px-4 py-3', s.border, s.bg)}>
      {/* Level 1：当前动作（手机端允许标题换行，不挤出 viewport） */}
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-xl" aria-hidden>
          {action.emoji}
        </span>
        <span className={cn('min-w-0 flex-1 break-words text-base font-semibold leading-snug', s.text)}>{action.title}</span>
      </div>
      <p className="break-words text-sm leading-relaxed text-foreground">{action.summary}</p>

      {/* Level 2：关键价格（手机端单列，防长价格+长标签把双列挤出 viewport） */}
      {action.code !== 'DATA_BLOCKED' && (
        <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <KeyPrice label="当前价格" value={k.currentPrice} />
          <KeyPrice label="本轮突破位" value={k.breakoutLevel} title="本次 Independent Breakout Episode 当时突破的关键阻力" />
          <KeyPrice label="结构失效位" value={k.invalidationLevel} title="跌破后，本轮结构失效" />
          <KeyPrice label="当前下一压力" value={k.nextResistance} title="根据最新滚动窗口计算出的下一关键阻力" />
          {k.currentDistancePct != null && k.breakoutLevel != null && (
            <div className="flex items-center justify-between rounded-md bg-background/60 px-2.5 py-1.5">
              <span className="text-muted-foreground" title="当前价格相对本轮突破位的距离">
                当前距突破位
              </span>
              <span className="tnum font-mono text-foreground">{formatPct(k.currentDistancePct)}</span>
            </div>
          )}
          {k.breakoutExtensionPct != null && (
            <div className="flex items-center justify-between rounded-md bg-background/60 px-2.5 py-1.5">
              <span className="text-muted-foreground" title="突破收盘价相对本轮突破位的超越幅度">
                突破当根超越幅度
              </span>
              <span className="tnum font-mono text-foreground">{formatPct(k.breakoutExtensionPct)}</span>
            </div>
          )}
        </div>
      )}
      {k.episodeAgeHours != null && (
        <p className="text-[11px] text-muted-foreground">本轮突破距今约 {Math.round(k.episodeAgeHours)}h（仅解释信息，不做失效判定）。</p>
      )}

      {/* Level 3：为什么 */}
      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">为什么</div>
        {action.reasons.map((r, i) => (
          <div key={i} className="flex min-w-0 gap-1.5 text-xs leading-relaxed">
            <span className={cn('shrink-0', r.ok ? 'text-radar' : 'text-bear')}>{r.ok ? '✓' : '✗'}</span>
            <span className="min-w-0 flex-1 break-words text-foreground/90">{r.text}</span>
          </div>
        ))}
      </div>

      {action.warnings.length > 0 && (
        <div className="space-y-1">
          {action.warnings.map((w, i) => (
            <p key={i} className="break-words text-[11px] leading-relaxed text-warn">
              ※ {w}
            </p>
          ))}
        </div>
      )}

      {/* Level 3：接下来观察（什么会改变判断） */}
      <div className="space-y-1">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">接下来观察</div>
        {action.nextConditions.map((n, i) => (
          <div key={i} className="flex min-w-0 gap-1.5 text-xs leading-relaxed">
            <span className="shrink-0 text-muted-foreground">→</span>
            <span className="min-w-0 flex-1 break-words text-foreground/90">
              {n.condition}
              <span className="text-muted-foreground"> → {n.outcome}</span>
            </span>
          </div>
        ))}
      </div>

      {action.episodeStatus && <p className="break-words text-[11px] text-muted-foreground">{action.episodeStatus}</p>}
      {action.dataFreshness.status !== 'ok' && action.dataFreshness.lastUpdatedTs != null && (
        <p className="break-words text-[11px] text-muted-foreground">最后有效更新：{formatTs(action.dataFreshness.lastUpdatedTs)}</p>
      )}
    </div>
  );
}

function KeyPrice({ label, value, title }: { label: string; value: number | null; title?: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2 rounded-md bg-background/60 px-2.5 py-1.5">
      <span className="min-w-0 text-muted-foreground" title={title}>
        {label}
      </span>
      <span className="tnum max-w-[60%] shrink-0 break-all text-right font-mono text-foreground">{formatPricePlain(value)}</span>
    </div>
  );
}
