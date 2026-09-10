/**
 * P0 数据基建：Instrument Registry（canonical 唯一来源，§2 通则 / §0.2）。
 *
 * - 合约单位差异（1000PEPE / PEPE 等）一律走本 registry 归一到 notional / canonical 价，
 *   **禁在各处硬编码 multiplier**（禁散落 `1000` / `0.001` 常量做换算）。
 * - symbol 唯一来源：本文件内静态快照（OKX instId / 现货 instId / Binance 永续
 *   symbol），与业务 `config.ASSETS` 同值但**不 import**（探针同款解耦：research
 *   基建不依赖业务配置，业务侧改 symbol 不自动穿透；改本表必须 bump 版本，
 *   漂移由 REG-3 单测同值校验发现）。
 * - BTC 的 Binance 永续 `BTCUSDT` 为本文件内唯一显式声明
 *   （业务侧该字段为空串，registry 是唯一允许落字处）。
 * - 范围冻结：标的仅 PEPE / DOGE / ETHFI + BTC（环境参照）；交易所仅 okx / binance。
 *   禁新增币种数据源，禁 Bybit / CoinGlass（含常量）。
 * - 本模块为纯数据 + 纯函数，无网络、无评分、无权重（Quant NONE）。
 */

export type MarketType = 'spot' | 'perp';
export type VenueExchange = 'okx' | 'binance';
export type SymbolNorm = 'PEPE' | 'DOGE' | 'ETHFI' | 'BTC';

/** Registry 版本：归一逻辑变更必须 bump（Schema 的 instrument_registry_version 引用它）。 */
export const INSTRUMENT_REGISTRY_VERSION = '1.0.0';

export interface RegistryEntry {
  /** 主键（去重键唯一身份的一部分，见 ingest.buildDedupKey）。 */
  key: string;
  version: string;
  exchange: VenueExchange;
  marketType: MarketType;
  symbolNorm: SymbolNorm;
  /** 交易所原始 symbol，仅透传，禁作跨市场 join 键。 */
  symbolRaw: string;
  canonicalBaseAsset: SymbolNorm;
  /**
   * native→canonical 缩放声明：1 个 native 数量单位 = 多少 canonical base 数量。
   * 例：OKX PEPE 永续 native 为单个 PEPE → 1；Binance 1000PEPE 合约 native 为
   * 1000PEPE 单位 → 1000。价格归一：price_canonical = price_native / unitsPerNative
   * （1000PEPE 合约价除以 1000 得单个 PEPE 可比价）；数量归一反向相乘：
   * qty_canonical = qty_native × unitsPerNative。
   * 该数值只允许出现在此 registry 内，adapter 必须经 lookup 读取，禁手写常量。
   */
  unitsPerNative: number;
}

function entry(
  exchange: VenueExchange,
  marketType: MarketType,
  symbolNorm: SymbolNorm,
  symbolRaw: string,
  unitsPerNative: number,
): RegistryEntry {
  const key = `${exchange.toUpperCase()}-${marketType.toUpperCase()}-${symbolRaw.replace(/[^A-Z0-9]/gi, '').toUpperCase()}`;
  return {
    key,
    version: INSTRUMENT_REGISTRY_VERSION,
    exchange,
    marketType,
    symbolNorm,
    symbolRaw,
    canonicalBaseAsset: symbolNorm,
    unitsPerNative,
  };
}

/**
 * 解耦快照（research 侧单一来源，不 import 业务配置；与业务 ASSETS 同值，
 * 漂移由 REG-3 同值校验发现，不自动穿透）。
 * PEPE 在 Binance 为 1000PEPEUSDT 乘数口径（unitsPerNative=1000），其余均为 1。
 */
const OKX_PERP_INST: Record<SymbolNorm, string> = {
  PEPE: 'PEPE-USDT-SWAP',
  DOGE: 'DOGE-USDT-SWAP',
  ETHFI: 'ETHFI-USDT-SWAP',
  BTC: 'BTC-USDT-SWAP',
};

const OKX_SPOT_INST: Record<SymbolNorm, string> = {
  PEPE: 'PEPE-USDT',
  DOGE: 'DOGE-USDT',
  ETHFI: 'ETHFI-USDT',
  BTC: 'BTC-USDT',
};

/** Binance 永续 symbol 快照（BTC 在业务侧为空串，此处显式声明 BTCUSDT）。 */
const BINANCE_PERP_SYMBOL: Record<SymbolNorm, string> = {
  PEPE: '1000PEPEUSDT',
  DOGE: 'DOGEUSDT',
  ETHFI: 'ETHFIUSDT',
  BTC: 'BTCUSDT',
};

/**
 * 全量注册表（冻结范围：2 所 ×（perp 必备 + spot 描述）× 4 标的）。
 * Binance PEPE 永续原生单位为 1000PEPE（unitsPerNative=1000），其余均为 1。
 */
function buildRegistry(): RegistryEntry[] {
  const coins: SymbolNorm[] = ['PEPE', 'DOGE', 'ETHFI', 'BTC'];
  const out: RegistryEntry[] = [];
  for (const coin of coins) {
    // OKX 永续（实时链路口径）+ OKX 现货（描述口径，禁拿现货冒充永续）。
    out.push(entry('okx', 'perp', coin, OKX_PERP_INST[coin], 1));
    out.push(entry('okx', 'spot', coin, OKX_SPOT_INST[coin], 1));
    // Binance 永续：快照 symbol；BTC 业务侧为空，此处显式 BTCUSDT。
    const raw = BINANCE_PERP_SYMBOL[coin];
    const units = coin === 'PEPE' ? 1000 : 1;
    out.push(entry('binance', 'perp', coin, raw, units));
    // Binance 现货：与永续同 symbol 字符串但 market_type 不同，必须可区分（HIGH-1）。
    // 现货 raw 与永续同串（U 本位语义下同名），key 因 market_type 不同而不同。
    out.push(entry('binance', 'spot', coin, raw, units));
  }
  return out;
}

export const INSTRUMENT_REGISTRY: readonly RegistryEntry[] = buildRegistry();

const byKey = new Map<string, RegistryEntry>(INSTRUMENT_REGISTRY.map((e) => [e.key, e]));

/** 按（所，market_type，标的）查表；查不到返回 null（调用方按缺数据处理，禁编造）。 */
export function lookupInstrument(
  exchange: VenueExchange,
  marketType: MarketType,
  symbolNorm: SymbolNorm,
): RegistryEntry | null {
  const found = INSTRUMENT_REGISTRY.find(
    (e) => e.exchange === exchange && e.marketType === marketType && e.symbolNorm === symbolNorm,
  );
  return found ?? null;
}

export function getInstrumentByKey(key: string): RegistryEntry | null {
  return byKey.get(key) ?? null;
}

/** 价格归一：price_canonical = price_native / unitsPerNative（经 registry 读取缩放）。 */
export function canonicalizePrice(entryOrKey: RegistryEntry | string, priceNative: number): number | null {
  const e = typeof entryOrKey === 'string' ? getInstrumentByKey(entryOrKey) : entryOrKey;
  if (!e || !Number.isFinite(priceNative) || e.unitsPerNative <= 0) return null;
  return priceNative / e.unitsPerNative;
}

/** 数量归一：qty_canonical = qty_native × unitsPerNative（与价格方向相反）。 */
export function canonicalizeQty(entryOrKey: RegistryEntry | string, qtyNative: number): number | null {
  const e = typeof entryOrKey === 'string' ? getInstrumentByKey(entryOrKey) : entryOrKey;
  if (!e || !Number.isFinite(qtyNative)) return null;
  return qtyNative * e.unitsPerNative;
}
