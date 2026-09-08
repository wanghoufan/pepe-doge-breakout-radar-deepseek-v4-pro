/**
 * 数据新鲜度（P0 可靠性整改，纯函数，无网络、无 UI）。
 *
 * 定位：把「数据有多旧」统一成三态，供 overview / Action / 来源新鲜度行共用。
 * - 三态：'ok' | 'stale' | 'unavailable'（与 ActionInput.dataStatus 同口径）。
 * - 这是可靠性 SLA（数据链路是否新鲜），不是交易阈值/权重/M5，不参与任何评分与回测。
 * - 判定只依赖时间戳，不读交易所、不碰密钥、不做声音报警。
 */

export type FeedStatus = 'ok' | 'stale' | 'unavailable';

export interface FeedFreshness {
  status: FeedStatus;
  lastUpdatedTs: number | null;
  reason: string | null;
}

/**
 * K 线/现价链路判 stale 的最大允许年龄。
 * 4H 口径下漏掉连续 2 根已收盘 K 线（8h）即判 stale，要求人工关注而不是继续当 fresh 用。
 * 仅用于新鲜度展示与 DATA_BLOCKED 门控，不进入任何量化评分。
 */
export const CANDLE_STALE_AFTER_MS = 8 * 3_600_000;

/** 资金费率链路判 stale 的最大允许年龄（相对 K 线末根，24h ≈ 漏 3 期）。 */
export const FUNDING_STALE_AFTER_MS = 24 * 3_600_000;

function isValidTs(v: number | null): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * 单路新鲜度：null/非法 → unavailable；年龄超限 → stale；否则 ok。
 * 允许 5 分钟未来时钟漂移（仍判 ok）。
 */
export function assessFeedFreshness(
  lastUpdatedTs: number | null,
  now: number = Date.now(),
  staleAfterMs: number = CANDLE_STALE_AFTER_MS,
): FeedFreshness {
  if (!isValidTs(lastUpdatedTs)) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '无最后有效更新时间' };
  }
  const age = now - (lastUpdatedTs as number);
  if (age < -5 * 60_000) {
    return { status: 'ok', lastUpdatedTs, reason: null };
  }
  if (age > staleAfterMs) {
    const h = Math.floor(age / 3_600_000);
    return {
      status: 'stale',
      lastUpdatedTs,
      reason: `数据已过期约 ${h}h（超 ${Math.floor(staleAfterMs / 3_600_000)}h 未更新）`,
    };
  }
  return { status: 'ok', lastUpdatedTs, reason: null };
}

/**
 * overview 级三态（P0-1）：feed 级缺失走 unavailable，不沿用旧信号。
 * - okxOk=false 或 canAnalyze=false → unavailable（与 MarketOverview.status 口径一致）。
 * - 任一必需时间戳缺失 → unavailable。
 * - 任一必需时间戳 stale → stale。
 * - 否则 ok。
 * 必需时间戳 = 各币种最后已收盘 K 线 + 各币种现价 ts（ funding 不阻塞 overview，见 P0-2）。
 */
export function deriveOverviewFreshness(input: {
  okxOk: boolean;
  canAnalyze: boolean;
  lastConfirmedTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
  priceTs: { PEPE: number | null; DOGE: number | null; BTC: number | null };
  now?: number;
}): FeedFreshness {
  const now = input.now ?? Date.now();
  if (!input.okxOk || !input.canAnalyze) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '实时链路非 live，信号可能不是最新' };
  }
  const required: (number | null)[] = [
    input.lastConfirmedTs.PEPE,
    input.lastConfirmedTs.DOGE,
    input.lastConfirmedTs.BTC,
    input.priceTs.PEPE,
    input.priceTs.DOGE,
    input.priceTs.BTC,
  ];
  if (required.some((v: number | null) => !isValidTs(v))) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '部分必需时间戳缺失，无法判定新鲜度' };
  }
  const tsList = required as number[];
  const oldest = Math.min(...tsList);
  const assessed = assessFeedFreshness(oldest, now, CANDLE_STALE_AFTER_MS);
  if (assessed.status === 'stale') {
    return {
      status: 'stale',
      lastUpdatedTs: oldest,
      reason: `最后有效更新距今超 ${Math.floor(CANDLE_STALE_AFTER_MS / 3_600_000)}h（疑似停更）`,
    };
  }
  return { status: 'ok', lastUpdatedTs: oldest, reason: null };
}

/**
 * 资金费率新鲜度（相对 K 线末根，不依赖墙钟，便于引擎内纯判定）。
 * funding 为空 → unavailable；末点相对 bars 末根过旧 → stale；否则 ok。
 */
export function assessFundingFreshness(
  funding: { ts: number }[],
  barsLastTs: number | null,
): FeedFreshness {
  if (!funding.length || !isValidTs(barsLastTs)) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '资金费率缺失' };
  }
  const last = funding[funding.length - 1].ts;
  if (!isValidTs(last)) {
    return { status: 'unavailable', lastUpdatedTs: null, reason: '资金费率时间戳非法' };
  }
  const age = (barsLastTs as number) - last;
  if (age > FUNDING_STALE_AFTER_MS) {
    return { status: 'stale', lastUpdatedTs: last, reason: '资金费率相对 K 线停更超 24h' };
  }
  return { status: 'ok', lastUpdatedTs: last, reason: null };
}
