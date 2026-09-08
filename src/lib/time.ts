/**
 * 时间与 K 线边界统一工具（V2）。
 *
 * 整改原则（P0-1）：
 * - 内部一律使用 UTC 毫秒时间戳（epoch ms），不做任何只有日期的歧义计算。
 * - 历史事件配置过去用 'YYYY-MM-DD' 这种无时区日期参与计算，导致与
 *   Asia/Shanghai（UTC+8）日历日之间产生 8 小时错位。现统一：
 *   事件日期一律理解为「北京时间（Asia/Shanghai）日历日 00:00」，
 *   显式转成 UTC ISO 时间戳（前一日 16:00Z）后再参与计算。
 * - 展示层才转成 Asia/Shanghai，见 format.ts。
 * - 4H K 线边界对齐 UTC epoch（ts % 4H === 0），本模块提供边界对齐/收盘判断工具。
 */

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;
/** 4H K 线时长（毫秒）。 */
export const CANDLE_4H_MS = 14_400_000;
/** 每日 4H K 线根数（6 根）。 */
export const CANDLES_PER_DAY_4H = 6;
/** Asia/Shanghai 相对 UTC 的固定偏移（中国无夏令时）。 */
export const CST_OFFSET_MS = 8 * HOUR_MS;

/** 中国标准时区标识。 */
export const TZ_SHANGHAI = 'Asia/Shanghai';

/**
 * 把「北京时间日历日」字符串（如 '2026-02-10'）解析为 UTC 毫秒时间戳。
 * 语义：2026-02-10 00:00:00 (Asia/Shanghai) == 2026-02-09T16:00:00Z。
 * 禁止再用 Date.parse(`${d}T00:00:00Z`)（那会把日期当成 UTC 午夜）。
 */
export function parseCSTDate(date: string): number {
  const ms = Date.parse(`${date}T00:00:00+08:00`);
  if (Number.isNaN(ms)) throw new Error(`无法解析日期：${date}`);
  return ms;
}

/** 解析完整 ISO 时间戳（带 Z 或时区偏移），返回 UTC 毫秒。 */
export function parseISO(iso: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`无法解析 ISO 时间戳：${iso}`);
  return ms;
}

/**
 * 把给定 UTC 毫秒时间戳向下对齐到 4H K 线边界（candle open time）。
 * 返回 <= ts 且 ts % 4H === 0 的最大值。
 */
export function floorTo4H(ts: number): number {
  return Math.floor(ts / CANDLE_4H_MS) * CANDLE_4H_MS;
}

/**
 * 判断一根 4H K 线在给定「当前时间 now」是否已经收盘。
 * 收盘时刻 = candle open ts + 4H。
 *
 * Phase A 统一语义（全仓唯一口径）：
 * - candleOpenTs 是区间起点，K 线覆盖 [candleOpenTs, candleOpenTs + 4H)。
 * - confirmed candle 的 candleCloseTs = openTs + 4H（见 candleCloseTs）。
 * - 禁止把 openTs 直接解读为「最后更新时间」：展示「X 前收盘」必须用
 *   now - candleCloseTs，而不是 now - candleOpenTs（后者会虚增 4h）。
 */
export function isCandleClosed(candleOpenTs: number, now: number): boolean {
  return now >= candleOpenTs + CANDLE_4H_MS;
}

/**
 * Phase A：confirmed candle 的收盘时间戳 = openTs + 4H。
 * 仅对已收盘 K 线有意义；未收盘（形成中）K 线没有 closeTs，绝不能拿来确认突破。
 */
export function candleCloseTs(candleOpenTs: number): number {
  return candleOpenTs + CANDLE_4H_MS;
}

/**
 * Phase A：当前正在形成中的 4H K 线的 openTs（= floorTo4H(now)）。
 * 这根 K 线未收盘，只作展示 / INTRABAR 提示，不参与任何突破判定与新鲜度 actual。
 */
export function current4HOpenTs(now: number): number {
  return floorTo4H(now);
}

/**
 * Phase A：期望的「最近一根已收盘」4H K 线 openTs = floorTo4H(now) - 4H。
 * 新鲜度判定拿 actualLastConfirmedOpenTs 与它对比（见 freshness.ts）。
 */
export function expectedLastConfirmedOpenTs(now: number): number {
  return floorTo4H(now) - CANDLE_4H_MS;
}

/**
 * 返回指定根数的 4H 回看窗口所对应的毫秒时长。
 * 例：7 天 = 7 * 6 = 42 根 = 42 * 4H。
 */
export function candlesToMs(count: number): number {
  return count * CANDLE_4H_MS;
}

/** 把毫秒时长转换为 4H K 线根数（向下取整）。 */
export function msToCandles(ms: number): number {
  return Math.floor(ms / CANDLE_4H_MS);
}
