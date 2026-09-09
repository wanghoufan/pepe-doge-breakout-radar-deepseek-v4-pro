'use client';

import {
  assessCandleFreshness,
  assessFeedFreshness,
  candleMainCopy,
  priceMainCopy,
  summarizeSourceFreshness,
  CANDLE_STALE_AFTER_MS,
  FUNDING_STALE_AFTER_MS,
} from '@/lib/freshness';
import { CANDLE_4H_MS } from '@/lib/time';
import { formatClock, formatTs, relativeTime } from '@/lib/format';

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
 * Phase A：现价与 K 线新鲜度分离显示（三行，单币种，全站统一口径）。
 * - 第 1 行（现价）：现价PEPE·LIVE·刚刚（ticker 时间戳，8h 年龄口径）。
 * - 第 2 行（K 线）：K线PEPE·LIVE·最近收盘2小时20分钟前（closeTs 口径，
 *   禁止 openTs 直算）+ 最近4H收盘区间（全站一种）。
 * - 第 3 行（形成中）：当前 4H 区间 + 未收盘 K 线绝不确认突破。
 * MED-9：绝对时间收 title tooltip（正文只留相对口径），第二行拆段（主口径一行、
 * 区间一行），禁相对+绝对重复堆叠。
 * 纯展示：判定来自 freshness.ts 纯函数，组件内无策略逻辑。
 */
export function CandleFreshnessBlock({
  coin,
  priceTs,
  actualOpenTs,
  now,
}: {
  coin: 'PEPE' | 'DOGE' | 'BTC' | 'ETHFI';
  priceTs: number | null;
  /** 最近已收盘 K 线 openTs（open 语义；缺失/非法传 null → UNAVAILABLE）。 */
  actualOpenTs: number | null;
  now: number;
}) {
  const price = assessFeedFreshness(priceTs, now, CANDLE_STALE_AFTER_MS);
  const candle = assessCandleFreshness(actualOpenTs, now);
  const closeTs = candle.actualLastConfirmedCloseTs;
  const formingOpen = candle.current4HOpenTs;
  return (
    <div className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
      <div title={priceTs ? `更新于 ${formatTs(priceTs)}` : '无更新'}>
        {priceMainCopy(coin, priceTs, now, price.status)}
      </div>
      <div title={closeTs != null && actualOpenTs != null ? `最近4H收盘 ${formatTs(closeTs)}` : '最近收盘未知'}>
        <div>{candleMainCopy(coin, actualOpenTs, now, candle.status)}</div>
        {closeTs != null && actualOpenTs != null ? (
          <div>
            区间 {formatClock(actualOpenTs)}–{formatClock(closeTs)}
          </div>
        ) : null}
      </div>
      <div>
        当前4H形成中 {formatClock(formingOpen)}–{formatClock(formingOpen + CANDLE_4H_MS)}，未收盘K线不确认突破
      </div>
    </div>
  );
}
/**
 * P0-3 来源新鲜度行（纯展示，无声音报警、无判定逻辑）。
 * 每路独立显示 ok/stale/unavailable + 最后更新 + 相对时间；阈值复用 freshness 单一来源。
 * Phase A：K 线三路改走期望收盘 Bar 对比（assessCandleFreshness），展示统一主口径
 * （candleMainCopy，closeTs 口径，禁止 openTs 直算）；现价/资金费率仍走年龄口径。
 * HIGH-3：新鲜度收敛一处——桌面留三行（CandleFreshnessBlock），本行收敛为一行摘要，
 * 全明细收 title tooltip（禁约 10 badge 与三行同时堆叠）。
 */
export function SourceFreshnessRow({
  generatedAt,
  lastConfirmedTs,
  prices,
  fundingTs,
}: {
  generatedAt: number;
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null; ETHFI?: number | null } | null;
  prices: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', { last: number; ts: number } | null> | Record<'PEPE' | 'DOGE' | 'BTC', { last: number; ts: number } | null> | null;
  fundingTs: Record<'PEPE' | 'DOGE', number | null> | Record<'PEPE' | 'DOGE' | 'ETHFI', number | null> | null;
}) {
  const now = generatedAt;
  // Phase A：K 线走期望收盘 Bar 对比（open 语义输入，close 口径展示）；
  // 现价/资金费率走年龄口径。两类链路分离判定、统一主口径文案。
  const candleRows: { key: string; coin: 'PEPE' | 'DOGE' | 'BTC' | 'ETHFI'; ts: number | null }[] = [
    { key: 'K线 PEPE', coin: 'PEPE', ts: lastConfirmedTs?.PEPE ?? null },
    { key: 'K线 DOGE', coin: 'DOGE', ts: lastConfirmedTs?.DOGE ?? null },
    { key: 'K线 BTC', coin: 'BTC', ts: lastConfirmedTs?.BTC ?? null },
    ...('ETHFI' in (lastConfirmedTs ?? {}) ? [{ key: 'K线 ETHFI', coin: 'ETHFI' as const, ts: (lastConfirmedTs as { ETHFI?: number | null })?.ETHFI ?? null }] : []),
  ];
  const rows: { label: string; ts: number | null; staleAfter: number }[] = [
    { label: '现价 PEPE', ts: (prices as Record<string, { last: number; ts: number } | null>)?.PEPE?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: '现价 DOGE', ts: (prices as Record<string, { last: number; ts: number } | null>)?.DOGE?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    { label: '现价 BTC', ts: (prices as Record<string, { last: number; ts: number } | null>)?.BTC?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS },
    ...('ETHFI' in ((prices as object) ?? {}) ? [{ label: '现价 ETHFI', ts: (prices as Record<string, { last: number; ts: number } | null>)?.ETHFI?.ts ?? null, staleAfter: CANDLE_STALE_AFTER_MS }] : []),
    { label: '资金费率 PEPE', ts: (fundingTs as Record<string, number | null>)?.PEPE ?? null, staleAfter: FUNDING_STALE_AFTER_MS },
    { label: '资金费率 DOGE', ts: (fundingTs as Record<string, number | null>)?.DOGE ?? null, staleAfter: FUNDING_STALE_AFTER_MS },
    ...('ETHFI' in ((fundingTs as object) ?? {}) ? [{ label: '资金费率 ETHFI', ts: (fundingTs as Record<string, number | null>)?.ETHFI ?? null, staleAfter: FUNDING_STALE_AFTER_MS }] : []),
  ];
  const items: { label: string; status: 'ok' | 'stale' | 'unavailable'; detail: string }[] = [
    ...candleRows.map((r) => {
      const c = assessCandleFreshness(r.ts, now);
      const feed = c.status === 'LIVE' ? 'ok' : c.status === 'STALE' ? 'stale' : 'unavailable';
      return {
        label: r.key,
        status: feed as 'ok' | 'stale' | 'unavailable',
        detail: candleMainCopy(r.coin, r.ts, now, c.status),
      };
    }),
    ...rows.map((r) => {
      const f = assessFeedFreshness(r.ts, now, r.staleAfter);
      return {
        label: r.label,
        status: f.status,
        detail: f.lastUpdatedTs ? `${relativeTime(f.lastUpdatedTs)}（${formatTs(f.lastUpdatedTs)}）` : '无更新',
      };
    }),
  ];
  const { summary, title } = summarizeSourceFreshness(items);
  const hasBad = items.some((i) => i.status !== 'ok');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${hasBad ? 'border-warn/30 bg-warn/10 text-warn' : 'border-radar/30 bg-radar/10 text-radar'}`}
        title={title}
      >
        {summary}
      </span>
      <span className="text-muted-foreground/70">悬停查看各路明细</span>
    </div>
  );
}
