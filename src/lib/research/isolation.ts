/**
 * P0 数据基建：实时 Action 隔离门控（§3.1）。
 *
 * - 新增数据只进 server-side research store，实时 Action **禁止消费**本协议任何
 *   新字段：`market-service.ts` / `v2/engine.ts` / `action.ts` 禁 import 本目录
 *   任何模块（`research/schema|venue-adapters|field-freshness|ingest|store|
 *   instrument-registry`），禁引用新字段名（`oi_notional_usd` / `cvd_proxy` /
 *   `mark_index_basis_pct` / `funding_cross_diff_pp` / `instrument_registry_key` 等）。
 * - 本模块提供纯文本断言（供单测消费源文件文本做门控），自身亦不被实时链路 import。
 * - 纯函数，无网络、无评分（Quant NONE）。
 */

export const FORBIDDEN_IMPORTERS = [
  'src/lib/market-service.ts',
  'src/lib/v2/engine.ts',
  'src/lib/action.ts',
] as const;

/** 新基建模块标识（出现在实时链路 import 中即违规）。 */
export const FORBIDDEN_MODULE_FRAGMENTS = [
  'research/schema',
  'research/venue-adapters',
  'research/field-freshness',
  'research/ingest',
  'research/store',
  'research/instrument-registry',
] as const;

/** 新字段名（出现在实时链路源码中即违规，派生/展示复用除外——本轮一律禁入）。 */
export const FORBIDDEN_FIELD_FRAGMENTS = [
  'oi_notional_usd',
  'cvd_proxy',
  'taker_bs_ratio',
  'mark_index_basis_pct',
  'funding_cross_diff_pp',
  'spot_perp_dir_agree',
  'instrument_registry_key',
  'source_event_id',
  'rest-backfill',
] as const;

export interface IsolationViolation {
  file: string;
  fragment: string;
}

/**
 * 断言隔离：扫描给定文件文本，返回违规列表（空 = 通过）。
 * 调用方（单测）用 fs 读入实时链路三文件文本后传入。
 */
export function checkRealtimeIsolation(files: Record<string, string>): IsolationViolation[] {
  const out: IsolationViolation[] = [];
  for (const f of FORBIDDEN_IMPORTERS) {
    const text = files[f];
    if (typeof text !== 'string') continue;
    for (const frag of [...FORBIDDEN_MODULE_FRAGMENTS, ...FORBIDDEN_FIELD_FRAGMENTS]) {
      if (text.includes(frag)) out.push({ file: f, fragment: frag });
    }
  }
  return out;
}
