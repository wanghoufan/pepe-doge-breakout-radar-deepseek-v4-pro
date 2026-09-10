/**
 * P0 数据基建：venue adapter（§2 通则 venue-aware OI + 价格三层 + registry 归一）。
 *
 * - 通用公式 `oi_raw × mark × multiplier` 已否决，禁引用。
 * - OKX：优先官方 `oiUsd` 作为 `oi_notional_usd`；同时保留原生 `oi`（张数）、
 *   `oiCcy`、metadata 同行备查；无 oiUsd 时记 null（禁自算）。
 * - Binance：保留原生 `openInterest`，由本 adapter 内部转 `oi_notional_usd`
 *   （native 数量经 registry 归一到 canonical base 数量 × mark_canonical）；
 *   禁跨所复用 OKX 换算路径。
 * - 1000PEPE 缩放只从 registry 读取（unitsPerNative），本文件禁手写 1000 常量。
 * - 纯函数，无网络、无评分（Quant NONE）。
 */
import {
  canonicalizePrice,
  getInstrumentByKey,
  lookupInstrument,
  type MarketType,
  type SymbolNorm,
  type VenueExchange,
} from './instrument-registry';

export interface PriceTriple {
  price_native: number | null;
  unit_scale: string | null;
  price_canonical: number | null;
  canonical_base_asset: string | null;
}

/** 价格三层组装（HIGH-4）：native + registry 缩放声明 + canonical。 */
export function toPriceTriple(
  exchange: VenueExchange,
  marketType: MarketType,
  symbolNorm: SymbolNorm,
  priceNative: number | null,
): PriceTriple {
  const e = lookupInstrument(exchange, marketType, symbolNorm);
  if (!e || priceNative === null || !Number.isFinite(priceNative)) {
    return { price_native: priceNative, unit_scale: null, price_canonical: null, canonical_base_asset: null };
  }
  return {
    price_native: priceNative,
    unit_scale: `${e.symbolRaw}→${e.canonicalBaseAsset}:/${e.unitsPerNative}`,
    price_canonical: canonicalizePrice(e, priceNative),
    canonical_base_asset: e.canonicalBaseAsset,
  };
}

export interface OkxOiInput {
  symbolNorm: SymbolNorm;
  marketType?: MarketType;
  /** 官方 oi（张数，可为 null）。 */
  oi: string | number | null;
  oiCcy: string | null;
  /** 官方 oiUsd（优先口径，可为 null）。 */
  oiUsd: string | number | null;
  metadata?: Record<string, unknown>;
}

export interface NormalizedOi {
  oi_notional_usd: number | null;
  oi_native: number | null;
  oi_native_unit: string | null;
  oiCcy: string | null;
  oi_metadata: Record<string, unknown>;
  instrument_registry_key: string;
  instrument_registry_version: string;
}

const numOrNull = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};

/** OKX OI：优先官方 oiUsd；原生同行保留。 */
export function normalizeOkxOi(input: OkxOiInput): NormalizedOi {
  const e = lookupInstrument('okx', input.marketType ?? 'perp', input.symbolNorm);
  const oiUsd = numOrNull(input.oiUsd);
  return {
    oi_notional_usd: oiUsd,
    oi_native: numOrNull(input.oi),
    oi_native_unit: 'contracts',
    oiCcy: input.oiCcy,
    oi_metadata: input.metadata ?? {},
    instrument_registry_key: e?.key ?? '',
    instrument_registry_version: e?.version ?? '',
  };
}

export interface BinanceOiInput {
  symbolNorm: SymbolNorm;
  marketType?: MarketType;
  /** 原生 openInterest（数量，单位依合约而定，经 registry 归一）。 */
  openInterest: string | number | null;
  /** 同 ts 的 mark canonical 价（可比价；禁传 native 直乘）。 */
  markCanonical: number | null;
  metadata?: Record<string, unknown>;
}

/** Binance OI：原生保留 + 内部转 notional（registry 归一 × mark_canonical）。 */
export function normalizeBinanceOi(input: BinanceOiInput): NormalizedOi {
  const e = lookupInstrument('binance', input.marketType ?? 'perp', input.symbolNorm);
  const nativeQty = numOrNull(input.openInterest);
  let notional: number | null = null;
  if (e && nativeQty !== null && input.markCanonical !== null && Number.isFinite(input.markCanonical)) {
    const canonicalQty = nativeQty * e.unitsPerNative;
    notional = canonicalQty * (input.markCanonical as number);
  }
  return {
    oi_notional_usd: notional,
    oi_native: nativeQty,
    oi_native_unit: e?.symbolRaw ?? null,
    oiCcy: null,
    oi_metadata: input.metadata ?? {},
    instrument_registry_key: e?.key ?? '',
    instrument_registry_version: e?.version ?? '',
  };
}

/** 供 ingest/store 复用：按 key 归一价格（跨所价差只允许比较 canonical）。 */
export function canonicalPriceByKey(registryKey: string, priceNative: number): number | null {
  const e = getInstrumentByKey(registryKey);
  if (!e) return null;
  return canonicalizePrice(e, priceNative);
}
