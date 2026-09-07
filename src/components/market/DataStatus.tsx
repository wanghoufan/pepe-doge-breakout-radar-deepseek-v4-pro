'use client';

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
