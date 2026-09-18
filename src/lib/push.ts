/**
 * 全局推送（Web Push）纯逻辑层：状态边沿检测 + 去重键 + 通知 payload。
 *
 * 定位：服务端检查循环与测试共用的无副作用逻辑；不发起网络、不碰 DB、无 DOM。
 *
 * 科学边界（冻结，不可违反）：
 * - 不创造新信号：只消费现有 ActionCode（由调用方用 deriveActionState 算好）；
 *   本模块 import 禁止 mfe-mae/backtest/samples/event-metrics（禁未来数据）。
 * - 文案沿用 alert-center 的 ALERT_COPY / buildAlertBody，禁买入/胜率/概率/必涨。
 * - 只报「变化边沿」：同标的上一次 Action 与本次相同不报；冷启动只做基线不报
 *   （避免每次进程重启把当前状态重报一遍）。
 * - 去重键 = symbol|episodeId|actionState（与 alert-center buildAlertKey 同构，
 *   放宽 symbol 为任意已启用标的）。
 */
import {
  ALERT_COPY,
  BANNED_COPY_WORDS,
  buildAlertBody,
  isSubscribable,
  type SubscribableAction,
} from './alert-center';
import type { ActionCode } from './action';

export { BANNED_COPY_WORDS };

/** 推送文案禁语（复用 alert-center 唯一禁语表，测试逐条断言不出现）。 */
export const PUSH_BANNED_COPY_WORDS: readonly string[] = BANNED_COPY_WORDS;

/** 通知点击后跳回的默认应用首页。 */
export const PUSH_DEFAULT_URL = '/';

/* ------------------------------------------------------------------ */
/* 订阅记录 / 观察 / payload 类型                                        */
/* ------------------------------------------------------------------ */

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: PushSubscriptionKeys;
  createdAt: number;
}

/** 一次检查循环里对某标的的观察结果（ActionCode 由 deriveActionState 产出）。 */
export interface ActionObservation {
  symbol: string;
  action: ActionCode;
  episodeId: string | null;
  price: number | null;
  freshnessLabel: string;
  breakoutLevel?: number | null;
  invalidationLevel?: number | null;
}

/** Web Push 载荷（前端 Service Worker 直接消费；title/body/tag/url 固定四字段）。 */
export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

/* ------------------------------------------------------------------ */
/* 去重键                                                               */
/* ------------------------------------------------------------------ */

/** 去重键 = symbol|episodeId|actionState（episodeId 缺失记 no-episode）。 */
export function buildPushKey(symbol: string, episodeId: string | null, action: ActionCode): string {
  return `${symbol}|${episodeId ?? 'no-episode'}|${action}`;
}

/* ------------------------------------------------------------------ */
/* 状态边沿检测                                                          */
/* ------------------------------------------------------------------ */

export interface DetectEdgesOptions {
  /** true 时冷启动（无上一轮基线）也报；默认 false（只做基线，避免重启重报）。 */
  notifyOnFirstSeen?: boolean;
}

export interface DetectEdgesResult {
  edges: ActionObservation[];
  /** 本轮基线（供下一轮 prev 使用）。 */
  next: Record<string, ActionCode>;
}

/**
 * 只返回“状态发生变化”的观察（边沿）。
 * - 同标的上一次与本次 Action 相同 → 不报；
 * - 上一轮无该标的基线：默认只建立基线不报（notifyOnFirstSeen=false）；
 * - 返回 next 基线覆盖到本轮所有被观察标的（含未变化的）。
 */
export function detectActionEdges(
  prev: Record<string, ActionCode | undefined>,
  observations: ActionObservation[],
  opts: DetectEdgesOptions = {},
): DetectEdgesResult {
  const notifyFirst = opts.notifyOnFirstSeen ?? false;
  const edges: ActionObservation[] = [];
  const next: Record<string, ActionCode> = {};
  for (const obs of observations) {
    const previous = prev[obs.symbol];
    next[obs.symbol] = obs.action;
    if (previous === obs.action) continue;
    if (previous === undefined && !notifyFirst) continue;
    edges.push(obs);
  }
  return { edges, next };
}

/* ------------------------------------------------------------------ */
/* 订阅过滤 + 去重                                                       */
/* ------------------------------------------------------------------ */

export interface SelectPushableOptions {
  /** 可订阅状态开关（语义同 alert-center subscriptions）。 */
  subscriptions: Record<SubscribableAction, boolean>;
  /** 已推送过的去重键（进程内或持久化皆可）。 */
  seenKeys: Set<string> | string[];
}

/** 过滤边沿：仅保留「可订阅 + 已订阅 + 未推送过」的观察（NO_ACTION 永不推送）。 */
export function selectPushableEdges(
  edges: ActionObservation[],
  opts: SelectPushableOptions,
): ActionObservation[] {
  const has = (s: Set<string> | string[], k: string) => (Array.isArray(s) ? s.includes(k) : s.has(k));
  return edges.filter((e) => {
    if (!isSubscribable(e.action)) return false;
    if (!opts.subscriptions[e.action]) return false;
    if (has(opts.seenKeys, buildPushKey(e.symbol, e.episodeId, e.action))) return false;
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* 通知 payload（文案沿用 alert-center 口径，禁买入/胜率/概率/必涨）        */
/* ------------------------------------------------------------------ */

/**
 * 组装 Web Push 载荷；非可订阅状态（NO_ACTION）返回 null。
 * title/body 与页内提醒完全一致（alert-center ALERT_COPY + buildAlertBody），
 * tag 用去重键，url 固定应用首页。
 */
export function buildPushPayload(obs: ActionObservation): PushPayload | null {
  if (!isSubscribable(obs.action)) return null;
  const sub: SubscribableAction = obs.action;
  return {
    title: `${obs.symbol} · ${ALERT_COPY[sub].title}`,
    body: buildAlertBody(sub, obs.price, obs.freshnessLabel, {
      breakoutLevel: obs.breakoutLevel ?? null,
      invalidationLevel: obs.invalidationLevel ?? null,
    }),
    tag: buildPushKey(obs.symbol, obs.episodeId, sub),
    url: PUSH_DEFAULT_URL,
  };
}
