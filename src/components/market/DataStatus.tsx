'use client';

import { assessFeedFreshness, CANDLE_STALE_AFTER_MS, FUNDING_STALE_AFTER_MS } from '@/lib/freshness';
import { formatTs, relativeTime } from '@/lib/format';

export interface DiagLike {
  url?: string | null;
  host?: string | null;
  httpStatus?: number | null;
  vendorCode?: string | null;
  vendorMsg?: string | null;
  errorKind?: string | null;
  errorDetail?: string | null;
  durationMs?: number;
}

const PROVIDER_LABEL: Record<string, string> = {
  okx: 'OKX',
  binance: 'Binance',
};

/** 数据来源 + 最后更新时间（要求：页面必须显示数据来源和最后更新时间）。 */
export function SourceLine({
  provider,
  instId,
  fetchedAt,
  label,
}: {
  provider: string;
  instId?: string | null;
  fetchedAt?: number | null;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full border border-radar/30 bg-radar/10 px-2 py-0.5 text-radar">
        <span className="h-1.5 w-1.5 rounded-full bg-radar" />
        {label ?? '实时'} · {PROVIDER_LABEL[provider] ?? provider}
      </span>
      {instId ? <span className="font-mono">{instId}</span> : null}
      <span>
        最后更新 {fetchedAt ? `${formatTs(fetchedAt)}（${relativeTime(fetchedAt)}）` : '—'}
      </span>
    </div>
  );
}

/** 真实错误诊断展示（要求：输出实际请求地址 / HTTP 状态码 / 错误类型 / 交易所 code+msg）。 */
export function DiagBox({ diag, title }: { diag?: DiagLike | null; title?: string }) {
  if (!diag) return null;
  const rows: [string, string][] = [
    ['请求地址', diag.url ?? '—'],
    ['主机', diag.host ?? '—'],
    ['HTTP 状态码', diag.httpStatus == null ? '未建立连接' : String(diag.httpStatus)],
    ['错误类型', diag.errorKind ?? '—'],
    ['交易所 code', diag.vendorCode ?? '—'],
    ['交易所 msg', diag.vendorMsg ?? '—'],
    ['明细', diag.errorDetail ?? '—'],
  ];
  return (
    <div className="rounded-md border border-warn/30 bg-warn/5 p-3 text-[11px] leading-relaxed">
      {title ? <div className="mb-1 font-medium text-warn">{title}</div> : null}
      <dl className="grid gap-1 sm:grid-cols-[7rem_1fr]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="break-all font-mono text-foreground/90">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * P0-3 来源新鲜度行（纯展示，无声音报警、无判定逻辑）。
 * 每路独立显示 ok/stale/unavailable + 最后更新 + 相对时间；阈值复用 freshness 单一来源。
 */
export function SourceFreshnessRow({
  generatedAt,
  lastConfirmedTs,
  prices,
  fundingTs,
}: {
  generatedAt: number;
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null } | null;
  prices: Record<'PEPE' | 'DOGE' | 'BTC', { last: number; ts: number } | null> | null;
  fundingTs: Record<'PEPE' | 'DOGE', number | null> | null;
}) {
  const now = generatedAt;
  const rows: { label: string; ts: number | null; staleAfter: number }[] = [
    { label: 'K线 PEPE', ts: lastConfirmedTs?.PEPE ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: 'K线 DOGE', ts: lastConfirmedTs?.DOGE ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: 'K线 BTC', ts: lastConfirmedTs?.BTC ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: '现价 PEPE', ts: prices?.PEPE?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: '现价 DOGE', ts: prices?.DOGE?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: '现价 BTC', ts: prices?.BTC?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: '资金费率 PEPE', ts: fundingTs?.PEPE ?? null, staleAfter: FUNDING_STALE_AFTER_MS },
    { label: '资金费率 DOGE', ts: fundingTs?.DOGE ?? null, staleAfter: FUNDING_STALE_AFTER_MS },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span className="font-medium">来源新鲜度</span>
      {rows.map((r) => {
        const f = assessFeedFreshness(r.ts, now, r.staleAfter);
        const badge =
          f.status === 'ok'
            ? 'border-radar/30 bg-radar/10 text-radar'
            : f.status === 'stale'
              ? 'border-warn/30 bg-warn/10 text-warn'
              : 'border-bear/30 bg-bear/10 text-bear';
        const label = f.status === 'ok' ? 'ok' : f.status === 'stale' ? 'stale' : 'unavailable';
        return (
          <span
            key={r.label}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${badge}`}
            title={f.reason ?? `最后更新 ${formatTs(f.lastUpdatedTs)}`}
          >
            {r.label} · {label} · {f.lastUpdatedTs ? relativeTime(f.lastUpdatedTs) : '无更新'}
          </span>
        );
      })}
    </div>
  );
}
