/**
 * P0 数据基建：分字段 freshness 框架（§6-0 集中表）+ 正交双状态（§6-3 / P0-F）。
 *
 * - 表驱动：FIELD_FRESHNESS_POLICY 逐字段声明 collection_mode + cadenceKey + 倍数
 *   （stale=2×、unavailable=4×，倍数冻结；cadence 绝对值待 SOURCE_CADENCE_BASELINE_V1
 *   冻结，调用方显式传入 resolvedCadenceMs，未冻结时禁猜值代入判定）。
 * - 分字段独立：OI / trades / mark-index / funding 各自独立判定，禁跨字段复用
 *   （禁拿 K 线 freshness 冒充 OI/trades freshness）。
 * - Trade 特殊语义（R2 冻结）：transport 存活但无新成交仍 HEALTHY，禁以
 *   Market Event Age 判 stale；transport 断线/心跳超时才降级。
 * - funding current/history 双 policy：current 基准=实际采集 cadence，
 *   history 基准=settlement 周期，禁混用。
 * - Reliability（单源健康）与 Cross-market（双源一致性）正交：50bps 价差禁降级
 *   reliability，只走 cross_market 候选→连续 2 周期确认路径。
 * - 纯函数，无网络、无评分（Quant NONE）。
 */
import type { FieldFreshness, Reliability } from './schema';

export type FreshField = 'oi' | 'trades' | 'mark' | 'index' | 'funding_current' | 'funding_history' | 'depth';

export type CollectionMode = 'rest-poll' | 'ws' | 'ws-rest-fallback' | 'ws-rest-backfill';

/** 倍数冻结（§6-0）：stale=2× 基准，unavailable=4× 基准或连续 heartbeat 超时。 */
export const STALE_MULT = 2;
export const UNAVAIL_MULT = 4;

/** 跨市场候选阈值 50bps + 连续 2 周期确认（P0-F / §6-3 冻结）。 */
export const CROSS_DIFF_BPS_CANDIDATE = 50;
export const CROSS_CONFIRM_CYCLES = 2;

export interface FieldPolicy {
  field: FreshField;
  collectionMode: CollectionMode;
  /** cadence 基线键（绝对值见 SOURCE_CADENCE_BASELINE_V1，冻结前为 PROVISIONAL）。 */
  cadenceKey: string;
  heartbeatTimeoutKey: string;
  staleAfterKey: string;
  unavailableAfterKey: string;
  recovery: string;
}

/** §6-0 集中表（机器可读版；cadence 绝对值由基线文件冻结，此处只冻结结构与倍数）。 */
export const FIELD_FRESHNESS_POLICY: Record<FreshField, FieldPolicy> = {
  oi: {
    field: 'oi',
    collectionMode: 'rest-poll',
    cadenceKey: 'cadence_oi',
    heartbeatTimeoutKey: '2×cadence_oi 无响应',
    staleAfterKey: 'event age > 2×cadence_oi',
    unavailableAfterKey: 'event age > 4×cadence_oi 或连续 heartbeat 超时',
    recovery: '新 OI 事件到达且 event_time 前进',
  },
  trades: {
    field: 'trades',
    collectionMode: 'ws-rest-backfill',
    cadenceKey: 'cadence_trade（1m 聚合节拍，仅上卷/回补对齐，禁用于 stale 判定）',
    heartbeatTimeoutKey: 'heartbeat_timeout_trade（WS 无消息超时）',
    staleAfterKey: 'transport 断线/心跳超时即 stale（transport 存活禁以 Market Event Age 判 stale）',
    unavailableAfterKey: 'transport 断线 + 回补失败',
    recovery: 'WS 重连 + 序列缺口补齐',
  },
  mark: {
    field: 'mark',
    collectionMode: 'ws-rest-fallback',
    cadenceKey: 'cadence_mark',
    heartbeatTimeoutKey: '2×cadence_mark 无响应',
    staleAfterKey: 'event age > 2×cadence_mark',
    unavailableAfterKey: 'event age > 4×cadence_mark 或连续 heartbeat 超时',
    recovery: '新 mark 事件到达且 event_time 前进',
  },
  index: {
    field: 'index',
    collectionMode: 'ws-rest-fallback',
    cadenceKey: 'cadence_mark',
    heartbeatTimeoutKey: '2×cadence_mark 无响应',
    staleAfterKey: 'event age > 2×cadence_mark',
    unavailableAfterKey: 'event age > 4×cadence_mark 或连续 heartbeat 超时',
    recovery: '新 index 事件到达且 event_time 前进',
  },
  funding_current: {
    field: 'funding_current',
    collectionMode: 'rest-poll',
    cadenceKey: 'cadence_funding_current（实际采集 cadence，禁与 settlement 混用）',
    heartbeatTimeoutKey: '2×cadence_funding_current 无响应',
    staleAfterKey: 'event age > 2×cadence_funding_current',
    unavailableAfterKey: 'event age > 4×cadence_funding_current 或连续 heartbeat 超时',
    recovery: '新 funding_current 到达且事件时间前进（next_funding_time 禁作恢复依据）',
  },
  funding_history: {
    field: 'funding_history',
    collectionMode: 'rest-poll',
    cadenceKey: 'cadence_funding_history（= funding 结算周期，禁与采集 cadence 混用）',
    heartbeatTimeoutKey: '2×cadence_funding_history 无响应',
    staleAfterKey: 'event age 超过 2 个 settlement 周期未更新',
    unavailableAfterKey: 'event age 超过 4 个 settlement 周期或连续 heartbeat 超时',
    recovery: '新 funding 历史记录到达且 fundingTime 前进',
  },
  depth: {
    field: 'depth',
    collectionMode: 'ws-rest-backfill',
    cadenceKey: 'cadence_depth（P1-A 字段定义先行，首轮不验证）',
    heartbeatTimeoutKey: '2×cadence_depth 无响应',
    staleAfterKey: 'event age > 2×cadence_depth',
    unavailableAfterKey: 'event age > 4×cadence_depth 或连续 heartbeat 超时',
    recovery: '新 depth 快照到达且 sequence 前进',
  },
};

export interface FieldSample {
  field: FreshField;
  /** 市场事件年龄（now - event_time_ms）；trade 在 transport 存活时忽略此值。 */
  eventAgeMs: number | null;
  /** Transport 存活（WS 连接/心跳；rest-poll 字段传上次 poll 是否成功）。 */
  transportAlive: boolean;
  heartbeatExpired: boolean;
  backfillFailed?: boolean;
  /** 已冻结的 cadence 绝对值（ms）；null = 基线未冻结，禁判定（返回 unavailable + 原因）。 */
  resolvedCadenceMs: number | null;
}

export interface FieldVerdict {
  freshness: FieldFreshness;
  reason: string | null;
}

/**
 * 分字段判定（表驱动，倍数冻结）：
 * - resolvedCadenceMs=null → unavailable（基线未冻结，禁猜值）。
 * - trades：transport 存活且心跳未超时 → ok（事件年龄再大也禁判 stale）。
 * - 其余：eventAge > 4× → unavailable；> 2× → stale；transport 死/心跳超时 → 至少 stale。
 */
export function assessFieldFreshness(s: FieldSample): FieldVerdict {
  if (s.resolvedCadenceMs === null || !Number.isFinite(s.resolvedCadenceMs) || (s.resolvedCadenceMs as number) <= 0) {
    return { freshness: 'unavailable', reason: `${s.field} cadence 未冻结（基线待定），禁猜值判定` };
  }
  const cadence = s.resolvedCadenceMs as number;
  if (s.field === 'trades') {
    if (!s.transportAlive || s.heartbeatExpired) {
      if (!s.transportAlive && s.backfillFailed) {
        return { freshness: 'unavailable', reason: 'trade transport 断线 + 回补失败' };
      }
      return { freshness: 'stale', reason: 'trade transport 断线/心跳超时' };
    }
    return { freshness: 'ok', reason: null };
  }
  if (!s.transportAlive || s.heartbeatExpired) {
    if (s.eventAgeMs === null) return { freshness: 'unavailable', reason: `${s.field} 无事件时间且 transport 不存活` };
    if (s.eventAgeMs > UNAVAIL_MULT * cadence) {
      return { freshness: 'unavailable', reason: `${s.field} 事件年龄超 4×cadence` };
    }
    return { freshness: 'stale', reason: `${s.field} transport 断线/心跳超时` };
  }
  if (s.eventAgeMs === null || !Number.isFinite(s.eventAgeMs)) {
    return { freshness: 'unavailable', reason: `${s.field} 事件时间缺失` };
  }
  if (s.eventAgeMs > UNAVAIL_MULT * cadence) {
    return { freshness: 'unavailable', reason: `${s.field} 事件年龄超 4×cadence` };
  }
  if (s.eventAgeMs > STALE_MULT * cadence) {
    return { freshness: 'stale', reason: `${s.field} 事件年龄超 2×cadence` };
  }
  return { freshness: 'ok', reason: null };
}

/** 分字段 freshness → Reliability 映射（§6-2；价差禁参与此映射）。 */
export function freshnessToReliability(f: FieldFreshness): Reliability {
  return f === 'ok' ? 'HEALTHY' : f === 'stale' ? 'DEGRADED' : 'UNAVAILABLE';
}

/** canonical 价差 bps（跨所比较只用 canonical，禁 native 直算）。 */
export function priceDiffBps(aCanonical: number | null, bCanonical: number | null): number | null {
  if (aCanonical === null || bCanonical === null) return null;
  if (!Number.isFinite(aCanonical) || !Number.isFinite(bCanonical) || bCanonical === 0) return null;
  return (Math.abs(aCanonical - bCanonical) / Math.abs(bCanonical)) * 10_000;
}

export interface CrossMarketState {
  status: 'ALIGNED' | 'DIVERGED' | null;
  consecutiveHits: number;
}

/**
 * 正交跨市场更新（纯函数）：
 * - 任一源非 HEALTHY → null（不评 cross，避免单源故障污染跨市场结论）+ 计数清零。
 * - 双 HEALTHY 下 diff≥50bps 记一次候选命中；连续 2 周期命中才翻 DIVERGED；
 *   单周期命中只记候选不翻转；中断即清零回 ALIGNED。
 * - 只记 CROSS_MARKET_DIVERGENCE 事件语义，禁自动判数据错误、禁降级 reliability。
 */
export function updateCrossMarket(
  prev: CrossMarketState,
  diffBps: number | null,
  bothHealthy: boolean,
): CrossMarketState {
  if (!bothHealthy || diffBps === null || !Number.isFinite(diffBps)) {
    return { status: bothHealthy ? 'ALIGNED' : null, consecutiveHits: 0 };
  }
  if (diffBps >= CROSS_DIFF_BPS_CANDIDATE) {
    const hits = prev.consecutiveHits + 1;
    if (hits >= CROSS_CONFIRM_CYCLES) return { status: 'DIVERGED', consecutiveHits: hits };
    return { status: 'ALIGNED', consecutiveHits: hits };
  }
  return { status: 'ALIGNED', consecutiveHits: 0 };
}
