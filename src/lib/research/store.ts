/**
 * P0 数据基建：原始与派生分离存储（§3.1 / §6-4）。
 *
 * - 原始值永久保留（RawStore append-only，按 dedup_key 幂等），派生可重算
 *   （derive* 纯函数 + ResearchStore.derive 全量重算）。
 * - 派生口径冻结：
 *   OI 变化 `(v_t - v_{t-w}) / v_{t-w} × 100`（分母 0/缺失记 null）；
 *   taker：`trade` 明细经 source_diag 三要素（side/qtyCanonical/priceCanonical）
 *   还原 TakerTick 后按 instrument_registry_key 全量聚合（无效 tick 跳过，
 *   无有效 tick 的 key 无条目，禁零聚合冒充；调用方 1m 分桶后调
 *   aggregateTaker/rollupTaker 上卷）；
 *   `mark_index_basis_pct = (mark - index) / index × 100`（原 premium 改名；
 *   取各 key 最新 mark/index，单边缺失记 null，有任一边记录即有条目）；
 *   `funding_cross_diff_pp = (okx_raw - binance_raw) × 100`（按 symbol_norm
 *   跨所 join，任一缺失记 null，无记录的标的不出条目）。
 * - taker 口径声明：撮合层代理，不等同资金净流入、不等同上涨概率（调用方文档必带）。
 * - 纯函数 + 内存存储，无网络、无评分（Quant NONE）。
 */
import type { ResearchRecord } from './schema';

export class RawStore {
  private rows: ResearchRecord[] = [];
  private keys = new Set<string>();

  /** append-only 幂等追加；重复 dedup_key 返回 false（禁重复记录）。 */
  append(r: ResearchRecord): boolean {
    if (this.keys.has(r.dedup_key)) return false;
    this.keys.add(r.dedup_key);
    this.rows.push(r);
    return true;
  }

  appendMany(rs: ResearchRecord[]): { inserted: number; duplicates: number } {
    let inserted = 0;
    let duplicates = 0;
    for (const r of rs) {
      if (this.append(r)) inserted += 1;
      else duplicates += 1;
    }
    return { inserted, duplicates };
  }

  all(): readonly ResearchRecord[] {
    return this.rows;
  }

  byField(field: string): ResearchRecord[] {
    return this.rows.filter((r) => r.field === field);
  }

  get size(): number {
    return this.rows.length;
  }
}

export interface OiChange {
  chgPct: number | null;
  chgUsd: number | null;
}

/** OI 变化（分母 0/缺失记 null，禁记 0/无穷）。 */
export function computeOiChange(current: number | null, windowAgo: number | null): OiChange {
  if (current === null || windowAgo === null) return { chgPct: null, chgUsd: null };
  if (!Number.isFinite(current) || !Number.isFinite(windowAgo) || windowAgo === 0) {
    return { chgPct: null, chgUsd: current !== null && windowAgo !== null ? current - (windowAgo as number) : null };
  }
  return { chgPct: ((current - windowAgo) / windowAgo) * 100, chgUsd: current - windowAgo };
}

export interface TakerTick {
  side: 'buy' | 'sell';
  qtyCanonical: number;
  priceCanonical: number;
}

export interface TakerAggregate {
  buyNotional: number;
  sellNotional: number;
  /** buy / sell；sell=0 记 null，禁记 0/无穷。 */
  bsRatio: number | null;
  /** Σ(buy - sell)（USDT）；调用方记录窗口起点 ts（起点归零）。 */
  cvdProxy: number;
}

/** 1m taker 聚合（上卷到 5m/15m 前先按 1m 落库，保留明细以便重算）。 */
export function aggregateTaker(ticks: TakerTick[]): TakerAggregate {
  let buy = 0;
  let sell = 0;
  for (const t of ticks) {
    const notional = t.qtyCanonical * t.priceCanonical;
    if (!Number.isFinite(notional)) continue;
    if (t.side === 'buy') buy += notional;
    else sell += notional;
  }
  return { buyNotional: buy, sellNotional: sell, bsRatio: sell === 0 ? null : buy / sell, cvdProxy: buy - sell };
}

/** 上卷（1m 明细 → 5m/15m）：输入为各 1m 聚合，加总即可（明细保留，重算一致）。 */
export function rollupTaker(parts: TakerAggregate[]): TakerAggregate {
  const buy = parts.reduce((a, p) => a + p.buyNotional, 0);
  const sell = parts.reduce((a, p) => a + p.sellNotional, 0);
  return { buyNotional: buy, sellNotional: sell, bsRatio: sell === 0 ? null : buy / sell, cvdProxy: buy - sell };
}

/** 基差（原 premium 统一改名至此；原生 premiumIndex 另存，禁混用）。 */
export function computeBasisPct(markCanonical: number | null, indexCanonical: number | null): number | null {
  if (markCanonical === null || indexCanonical === null) return null;
  if (!Number.isFinite(markCanonical) || !Number.isFinite(indexCanonical) || indexCanonical === 0) return null;
  return ((markCanonical - indexCanonical) / indexCanonical) * 100;
}

/** 跨所费率差（均为原始比例未×100；任一缺失记 null，禁单源冒充差值）。 */
export function computeFundingCrossDiffPp(okxRaw: number | null, binanceRaw: number | null): number | null {
  if (okxRaw === null || binanceRaw === null) return null;
  if (!Number.isFinite(okxRaw) || !Number.isFinite(binanceRaw)) return null;
  return (okxRaw - binanceRaw) * 100;
}

export interface DerivedSnapshot {
  derivedAt: number;
  /** raw 条数（可重算校验：derive(同一 raw) 必须幂等一致）。 */
  rawCount: number;
  oiChange: Record<string, OiChange>;
  /** 按 instrument_registry_key 聚合；无有效 trade tick 的 key 无条目（禁零聚合）。 */
  taker: Record<string, TakerAggregate>;
  /** 按 instrument_registry_key；有任一边记录即有条目，单边缺失记 null。 */
  basisPct: Record<string, number | null>;
  /** 按 symbol_norm 跨所 join；任一边缺失记 null，无记录的标的不出条目。 */
  fundingCrossDiffPp: Record<string, number | null>;
}

/** 各 key 最新有效 value_norm（排序时间取 event_time_ms，缺失回退 receive_time_ms，仅排序用）。 */
function latestValueByKey(rows: readonly ResearchRecord[]): Map<string, number> {
  const best = new Map<string, { ts: number; v: number }>();
  for (const r of rows) {
    if (typeof r.value_norm !== 'number' || !Number.isFinite(r.value_norm)) continue;
    const k = r.instrument_registry_key;
    if (!k) continue;
    const ts = r.event_time_ms ?? r.receive_time_ms;
    if (!Number.isFinite(ts)) continue;
    const prev = best.get(k);
    if (!prev || (ts as number) >= prev.ts) best.set(k, { ts: ts as number, v: r.value_norm });
  }
  return new Map([...best].map(([k, e]) => [k, e.v] as const));
}

/**
 * trade 明细 → TakerTick（derive 接线口径）：
 * field 必须为 'trade'；side（'buy'|'sell'，大小写不敏感）、qtyCanonical（≥0 有限数）、
 * priceCanonical（>0 有限数）三要素一律从 source_diag 读取；任一缺失/非法则该 tick
 * 跳过（禁补 0、禁编造方向）。返回按 instrument_registry_key 分组的**有效** tick。
 */
export function takerTicksFromTradeRecords(rows: readonly ResearchRecord[]): Map<string, TakerTick[]> {
  const out = new Map<string, TakerTick[]>();
  for (const r of rows) {
    if (r.field !== 'trade') continue;
    const k = r.instrument_registry_key;
    if (!k) continue;
    const d = (r.source_diag ?? {}) as Record<string, unknown>;
    const sideRaw = typeof d['side'] === 'string' ? (d['side'] as string).toLowerCase() : null;
    if (sideRaw !== 'buy' && sideRaw !== 'sell') continue;
    const qty = d['qtyCanonical'];
    const price = d['priceCanonical'];
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) continue;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push({ side: sideRaw as 'buy' | 'sell', qtyCanonical: qty, priceCanonical: price });
  }
  return out;
}

/** 基差派生：各 key 最新 mark/index 经 computeBasisPct（单边缺失记 null）。 */
export function deriveBasisPct(
  markRows: readonly ResearchRecord[],
  indexRows: readonly ResearchRecord[],
): Record<string, number | null> {
  const mark = latestValueByKey(markRows);
  const index = latestValueByKey(indexRows);
  const out: Record<string, number | null> = {};
  for (const k of new Set([...mark.keys(), ...index.keys()])) {
    out[k] = computeBasisPct(mark.get(k) ?? null, index.get(k) ?? null);
  }
  return out;
}

/**
 * 跨所费率差派生：按 symbol_norm 跨所 join（分析维度 join，非去重身份）；
 * 各（所，标的）取最新 funding_current（原始比例未×100），经
 * computeFundingCrossDiffPp（任一缺失记 null）。
 */
export function deriveFundingCrossDiffPp(fundingRows: readonly ResearchRecord[]): Record<string, number | null> {
  const best = new Map<string, { ts: number; v: number }>();
  const symbols = new Set<string>();
  for (const r of fundingRows) {
    if (r.field !== 'funding_current') continue;
    if (!r.symbol_norm) continue;
    symbols.add(r.symbol_norm);
    if (typeof r.value_norm !== 'number' || !Number.isFinite(r.value_norm)) continue;
    const ts = r.event_time_ms ?? r.receive_time_ms;
    if (!Number.isFinite(ts)) continue;
    const mk = `${r.exchange}|${r.symbol_norm}`;
    const prev = best.get(mk);
    if (!prev || (ts as number) >= prev.ts) best.set(mk, { ts: ts as number, v: r.value_norm });
  }
  const out: Record<string, number | null> = {};
  for (const s of symbols) {
    out[s] = computeFundingCrossDiffPp(best.get(`okx|${s}`)?.v ?? null, best.get(`binance|${s}`)?.v ?? null);
  }
  return out;
}

/**
 * 原始/派生分离门面：raw 只追加，derived 每次全量重算（派生可重算举证：
 * 同一 raw 连续 derive 两次结果一致，且 raw 不被改写）。
 */
export class ResearchStore {
  readonly raw = new RawStore();

  derive(): DerivedSnapshot {
    const oiRows = this.raw.byField('oi_notional_usd');
    const oiChange: Record<string, OiChange> = {};
    const byKey = new Map<string, { ts: number; v: number }[]>();
    for (const r of oiRows) {
      if (typeof r.value_norm !== 'number' || r.event_time_ms === null) continue;
      const k = r.instrument_registry_key;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push({ ts: r.event_time_ms, v: r.value_norm });
    }
    for (const [k, series] of byKey) {
      series.sort((a, b) => a.ts - b.ts);
      const cur = series.at(-1) ?? null;
      const ago = series.length >= 2 ? series[0] : null;
      oiChange[k] = cur && ago ? computeOiChange(cur.v, ago.v) : { chgPct: null, chgUsd: null };
    }
    const taker: Record<string, TakerAggregate> = {};
    for (const [k, ticks] of takerTicksFromTradeRecords(this.raw.byField('trade'))) {
      taker[k] = aggregateTaker(ticks);
    }
    return {
      derivedAt: Date.now(),
      rawCount: this.raw.size,
      oiChange,
      taker,
      basisPct: deriveBasisPct(this.raw.byField('mark_price'), this.raw.byField('index_price')),
      fundingCrossDiffPp: deriveFundingCrossDiffPp(this.raw.byField('funding_current')),
    };
  }
}
