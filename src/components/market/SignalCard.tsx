'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StateBadge } from './StateBadge';
import { ActionCard } from './ActionCard';
import { ASSETS } from '@/lib/config';
import { formatPrice, formatPct, formatTs, formatRatio } from '@/lib/format';
import {
  deriveActionState,
  actionInputFromSignal,
  ENTRY_HEAT_COPY,
  SETUP_COPY,
  TRIGGER_COPY,
  FOLLOW_THROUGH_COPY,
  type ActionInput,
} from '@/lib/action';
import type { AssetId, AssetSignal, LayeredScore } from '@/lib/types';
import { cn } from '@/lib/utils';

const STATUS_LABEL: Record<LayeredScore['status'], string> = {
  COMPUTED: '',
  WAITING: '等待触发',
  PENDING: '数据待补齐',
  NOT_STARTED: '未开始',
  DATA_UNAVAILABLE: '数据不可用',
};

export function SignalCard({
  asset,
  signal,
  className,
  price,
  priceTs,
  dataStatus,
  staleReason,
}: {
  asset: AssetId;
  signal: AssetSignal | null;
  className?: string;
  price?: number | null;
  priceTs?: number | null;
  dataStatus?: ActionInput['dataStatus'];
  staleReason?: string | null;
}) {
  const meta = ASSETS[asset];
  const action = deriveActionState(
    actionInputFromSignal(signal, { asset, price: price ?? null, priceTs: priceTs ?? null, forcedStatus: dataStatus, staleReason }),
  );
  const historicalOnly = action.history.historicalOnly;

  return (
    <Card className={cn('relative overflow-hidden', className)}>
      <div
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.12] blur-2xl"
        style={{ background: meta.themecolor }}
      />
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <span className="font-mono" style={{ color: meta.themecolor }}>
              {meta.symbol}
            </span>
            <span className="text-sm font-normal text-muted-foreground">突破雷达</span>
          </CardTitle>
          {signal && (
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-xs text-muted-foreground">OKX 实时价</span>
              <span className="tnum font-mono text-sm">{formatPrice(price ?? null)}</span>
              {priceTs ? (
                <span className="text-[11px] text-muted-foreground">更新于 {formatTs(priceTs)}</span>
              ) : null}
            </div>
          )}
          {signal && <p className="mt-0.5 text-[11px] text-muted-foreground">判定口径 · 4H 已收盘 K 线</p>}
        </div>
        {signal && <StateBadge state={signal.state} />}
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Level 1–3：当前行动（永远排在最前） */}
        <ActionCard action={action} />
        {!signal && (
          <div className="py-6 text-center text-sm text-muted-foreground">实时信号不可用</div>
        )}
        {signal && (
          <>
            {signal.hardVeto.kind !== 'NONE' && (
              <div className="rounded-lg border border-bear/30 bg-bear/10 px-3 py-2 text-sm text-bear">
                ⚠ 硬否决（{signal.hardVeto.kind}）：{signal.hardVeto.reason}
              </div>
            )}

            {/* 环境闸门 */}
            <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
              <span className="text-xs text-muted-foreground">BTC 环境</span>
              <GateBadge gate={signal.environment.gate} />
            </div>

            {/* 分层评分（Level 5；失效后历史评分灰化，仅复盘） */}
            <div className={cn('space-y-1.5', historicalOnly && 'opacity-50 grayscale')}>
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {historicalOnly ? '本轮历史突破评分（仅用于复盘）' : '分层评分'}
              </div>
              <ScoreLine label="Setup · 蓄势" score={signal.setup} color={meta.themecolor} tooltip={SETUP_COPY.tooltip} />
              <ScoreLine label="Trigger · 突破结构完整度" score={signal.trigger} color="#8AB4F8" tooltip={TRIGGER_COPY.tooltip} />
              <ScoreLine
                label="Follow-through · 跟随"
                score={signal.followThrough}
                color="#4FC3F7"
                tooltip={FOLLOW_THROUGH_COPY.tooltip}
                gradeText={action.history.followThroughText}
              />
              <EntryHeatLine value={action.entryHeat.value} band={action.entryHeat.band} />
            </div>

            {/* 突破信息（EPISODE HISTORY：本轮突破当时） */}
            {signal.breakout.confirmed && (
              <div className="grid grid-cols-2 gap-2 text-xs">
                <LevelRow label="本轮突破位" value={signal.breakout.level} />
                <LevelRow label="突破收盘" value={signal.breakout.close} />
                <LevelRow label="突破当根超越幅度" custom={formatPct(signal.breakout.distancePct)} value={null} />
                <LevelRow label="突破量比" custom={formatRatio(signal.breakout.volumeRatio)} value={null} />
                {signal.breakout.ts != null && (
                  <div className="col-span-2 text-[11px] text-muted-foreground">
                    突破时点 {formatTs(signal.breakout.ts)}（{signal.breakout.hoursSinceBreakout ?? 0}h 前）
                  </div>
                )}
              </div>
            )}
            {signal.breakout.intradayAttempt && (
              <div className="rounded-md border border-warn/30 bg-warn/10 px-3 py-1.5 text-[11px] text-warn">
                盘中触及阻力（INTRABAR），尚未 4H 收盘确认。
              </div>
            )}

            {/* 关键价位 */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <LevelRow label="当前下一压力" value={signal.keyLevels.resistance} />
              <LevelRow label="结构失效位" value={signal.keyLevels.invalidation} />
              <LevelRow label="EMA20" value={signal.keyLevels.ema20} />
              <LevelRow
                label="相对 BTC"
                value={null}
                custom={signal.features.relativeStrengthPct == null ? '—' : formatPct(signal.features.relativeStrengthPct)}
              />
            </div>

            {/* 条件清单 */}
            <ConditionList signal={signal} />

            {signal.dataQuality.degraded && (
              <div className="text-[11px] text-warn">
                部分条件因数据缺失不可判定：{signal.dataQuality.missingFields.join('、')}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GateBadge({ gate }: { gate: 'ALLOW' | 'CAUTION' | 'BLOCK' }) {
  const map = {
    ALLOW: 'border-radar/30 bg-radar/10 text-radar',
    CAUTION: 'border-warn/30 bg-warn/10 text-warn',
    BLOCK: 'border-bear/30 bg-bear/10 text-bear',
  } as const;
  return <span className={cn('rounded-full border px-2.5 py-0.5 text-xs font-medium', map[gate])}>{gate}</span>;
}

function ScoreLine({
  label,
  score,
  color,
  tooltip,
  gradeText,
}: {
  label: string;
  score: LayeredScore;
  color: string;
  tooltip?: string;
  gradeText?: string;
}) {
  const hasValue = score.status === 'COMPUTED' && score.value != null;
  const status = STATUS_LABEL[score.status];
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5">
      <span className="text-xs text-muted-foreground" title={tooltip}>
        {label}
      </span>
      {hasValue ? (
        <span className="tnum font-mono text-sm font-medium" style={{ color }}>
          {gradeText ?? score.value}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">{status}</span>
      )}
    </div>
  );
}

/** Entry Heat（原 Risk）：追高/过热风险，不代表整笔交易亏损风险。 */
function EntryHeatLine({ value, band }: { value: number | null; band: '低' | '中' | '高' | '未知' }) {
  const color = band === '高' ? '#fb5e6e' : band === '中' ? '#f5a623' : band === '低' ? '#3ddc84' : undefined;
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-1.5">
      <span className="text-xs text-muted-foreground" title={ENTRY_HEAT_COPY.tooltip}>
        Entry Heat · 追高/过热
      </span>
      {value != null ? (
        <span className="tnum font-mono text-sm font-medium" style={color ? { color } : undefined}>
          {value} / 100 · {band}
        </span>
      ) : (
        <span className="text-[11px] text-muted-foreground">数据不可用</span>
      )}
    </div>
  );
}

function ConditionList({ signal }: { signal: AssetSignal }) {
  const met = [
    ...signal.setupConditions,
    ...signal.triggerConditions,
    ...signal.followThroughConditions,
  ].filter((c) => c.met && !c.unknown);
  const missing = [
    ...signal.setupConditions,
    ...signal.triggerConditions,
    ...signal.followThroughConditions,
  ].filter((c) => !c.met && !c.unknown);

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">条件清单</div>
      {met.slice(0, 5).map((c) => (
        <div key={c.key} className="flex gap-1.5 text-xs text-muted-foreground">
          <span className="text-radar">✓</span>
          <span className="truncate">{c.label}</span>
        </div>
      ))}
      {missing.slice(0, 4).map((c) => (
        <div key={c.key} className="flex gap-1.5 text-xs text-muted-foreground/70">
          <span className="text-muted-foreground">○</span>
          <span className="truncate">{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function LevelRow({ label, value, custom }: { label: string; value: number | null; custom?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="tnum font-mono text-foreground">{custom ?? formatPrice(value)}</span>
    </div>
  );
}
