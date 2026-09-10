/**
 * P0 数据基建：Research Record Schema（§3.2 HIGH-6 修订版逐字段落地）。
 *
 * - 每条记录必带：instrument identity 三件套（market_type + registry key/version）、
 *   价格三层（price_native / unit_scale / price_canonical / canonical_base_asset）、
 *   溯源版本（source_event_id / source_sequence / channel / snapshot_id /
 *   schema / collector / normalizer）、健康（reliability / cross_market /
 *   freshness / error_code / is_backfill / dedup_key / source_diag）。
 * - 去重键按 instrument_registry_key（§6-7 冻结语义），symbol_norm 只作分析维度。
 * - 纯类型 + 纯校验函数，无网络、无评分（Quant NONE）。
 */

export type VenueExchange = 'okx' | 'binance';
export type SymbolNorm = 'PEPE' | 'DOGE' | 'ETHFI' | 'BTC';
export type MarketType = 'spot' | 'perp';
export type Channel = 'ws' | 'rest' | 'rest-backfill';
export type Reliability = 'HEALTHY' | 'DEGRADED' | 'UNAVAILABLE';
export type CrossMarket = 'ALIGNED' | 'DIVERGED' | null;
export type FieldFreshness = 'ok' | 'stale' | 'unavailable';

export const SCHEMA_VERSION = '1.1.0';
export const COLLECTOR_VERSION = 'collector-p0.1.0';
export const NORMALIZER_VERSION = 'normalizer-p0.1.0';

/** §2 首轮字段名集合（P0-A/B/C/E/F + P1 字段定义先行；P1 仅定义不采集验证）。 */
export type ResearchField =
  | 'trade'
  | 'price'
  | 'volume'
  | 'oi_notional_usd'
  | 'oi_chg_15m'
  | 'oi_chg_1h'
  | 'oi_chg_4h'
  | 'oi_notional_chg_usd'
  | 'taker_buy_vol'
  | 'taker_sell_vol'
  | 'taker_bs_ratio'
  | 'cvd_proxy'
  | 'spot_vol'
  | 'perp_vol'
  | 'spot_perp_vol_ratio'
  | 'spot_perp_dir_agree'
  | 'mark_price'
  | 'index_price'
  | 'mark_index_basis_pct'
  | 'premium_index_native'
  | 'funding_current'
  | 'funding_history'
  | 'funding_cross_diff_pp'
  | 'next_funding_time'
  | 'reliability'
  | 'cross_market'
  | 'best_bid'
  | 'best_ask'
  | 'spread_bps'
  | 'depth_bid_0p5'
  | 'depth_ask_0p5'
  | 'depth_bid_1p0'
  | 'depth_ask_1p0';

export interface ResearchRecord {
  exchange: VenueExchange;
  /** 交易所原始 symbol，仅透传，禁作跨市场 join 键。 */
  symbol_raw: string;
  symbol_norm: SymbolNorm;
  market_type: MarketType;
  instrument_registry_key: string;
  instrument_registry_version: string;
  /** 价格三层：非价格类记录记 null。 */
  price_native: number | null;
  unit_scale: string | null;
  price_canonical: number | null;
  canonical_base_asset: string | null;
  field: ResearchField | string;
  value_raw: number | string;
  value_norm: number | null;
  /** 交易所事件时间（禁拿抓取时间冒充；无则 null）。 */
  event_time_ms: number | null;
  receive_time_ms: number;
  /**
   * 仅当交易所有原生事件 ID 时填写（如 tradeId / updateId）；
   * 无原生 ID 一律 null，禁编造、禁把源 ts 映射冒充原生 ID。
   * OI / funding 去重用源 ts，但 source_event_id 仍保持 null。
   */
  source_event_id: string | null;
  source_sequence: number | null;
  channel: Channel;
  /** 同一轮采集共享；REST 回补沿用原 snapshot_id + channel=rest-backfill。 */
  snapshot_id: string | null;
  schema_version: string;
  collector_version: string;
  normalizer_version: string;
  reliability: Reliability;
  cross_market: CrossMarket;
  freshness: FieldFreshness;
  error_code: string | null;
  is_backfill: boolean;
  dedup_key: string;
  source_diag: Record<string, unknown>;
}

export type RecordInput = Partial<ResearchRecord> &
  Pick<ResearchRecord, 'exchange' | 'symbol_raw' | 'symbol_norm' | 'field' | 'value_raw' | 'dedup_key'>;

/** 组装一条记录：版本字段自动填默认值，调用方只需填业务字段。 */
export function makeRecord(input: RecordInput): ResearchRecord {
  return {
    market_type: 'perp',
    instrument_registry_key: '',
    instrument_registry_version: '',
    price_native: null,
    unit_scale: null,
    price_canonical: null,
    canonical_base_asset: null,
    value_norm: typeof input.value_raw === 'number' ? input.value_raw : null,
    event_time_ms: null,
    receive_time_ms: Date.now(),
    source_event_id: null,
    source_sequence: null,
    channel: 'rest',
    snapshot_id: null,
    reliability: 'HEALTHY',
    cross_market: null,
    freshness: 'ok',
    error_code: null,
    is_backfill: false,
    source_diag: {},
    ...input,
    schema_version: SCHEMA_VERSION,
    collector_version: COLLECTOR_VERSION,
    normalizer_version: NORMALIZER_VERSION,
  };
}

/**
 * 校验（返回错误列表，空 = 通过）。
 * - instrument identity 三件套必填（trade/price/volume/OI 记录；本函数对全记录强制要求 key/version，调用方按 §3.2 判定必填范围）。
 * - is_backfill=true 时 channel 必须为 rest-backfill。
 * - source_event_id 为 string 时必须非空（禁空串冒充）。
 */
export function validateRecord(r: ResearchRecord): string[] {
  const errs: string[] = [];
  if (!r.exchange) errs.push('exchange 必填');
  if (!r.symbol_raw) errs.push('symbol_raw 必填（透传）');
  if (!r.field) errs.push('field 必填（§2）');
  if (!r.market_type) errs.push('market_type 必填（spot|perp）');
  if (!r.instrument_registry_key) errs.push('instrument_registry_key 必填');
  if (!r.instrument_registry_version) errs.push('instrument_registry_version 必填');
  if (!r.dedup_key) errs.push('dedup_key 必填（§6-7）');
  if (!Number.isFinite(r.receive_time_ms) || r.receive_time_ms <= 0) errs.push('receive_time_ms 非法');
  if (r.is_backfill && r.channel !== 'rest-backfill') errs.push('is_backfill=true 时 channel 必须为 rest-backfill');
  if (r.source_event_id !== null && r.source_event_id === '') errs.push('source_event_id 禁空串（无原生 ID 用 null）');
  if (r.event_time_ms !== null && !(Number.isFinite(r.event_time_ms) && r.event_time_ms > 0)) {
    errs.push('event_time_ms 非法');
  }
  return errs;
}
