/**
 * 全局推送服务（仅服务端）：VAPID 配置 + Web Push 发送 + 状态变化检查循环。
 *
 * 职责：
 * - 按固定间隔拉 getMarketOverview（复用现有市场服务），对「已启用信号标的」
 *   用 actionInputFromSignal + deriveActionState 推导 Action 状态（零重写判定）；
 * - 只对「可订阅 + 已订阅 + 未推送过」的状态变化边沿发 Web Push
 *   （去重键 symbol|episodeId|actionState）；
 * - 发送失败只记日志，绝不崩进程；404/410 视为订阅失效并清理。
 *
 * 科学边界：不碰任何阈值/权重/状态机判定，只消费结果；文案沿用 alert-center。
 * 循环随 src/server.ts 启动；Vercel serverless 无常驻进程，此循环不适用（生产另议）。
 */
import webpush from 'web-push';
import { getMarketOverview, type MarketOverview } from '../market-service';
import { getEnabledAssets } from '../registry';
import { getServerRegistry } from './registry-service';
import { tryOpenDb } from './sqlite';
import { readPushSubscriptions, deletePushSubscription } from './push-repository';
import { actionInputFromSignal, deriveActionState, type ActionCode } from '../action';
import { DEFAULT_SUBSCRIPTIONS } from '../alert-center';
import {
  buildPushKey,
  buildPushPayload,
  detectActionEdges,
  selectPushableEdges,
  type ActionObservation,
  type PushPayload,
} from '../push';

const DEFAULT_INTERVAL_MS = 60_000;
/** 进程内去重键上限（超出丢弃最旧，防长跑内存增长）。 */
const SEEN_KEYS_LIMIT = 2000;

/* ------------------------------------------------------------------ */
/* VAPID 配置                                                           */
/* ------------------------------------------------------------------ */

export function getVapidPublicKey(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY?.trim();
  return k ? k : null;
}

function getVapidPrivateKey(): string | null {
  const k = process.env.VAPID_PRIVATE_KEY?.trim();
  return k ? k : null;
}

/** 是否已配置 VAPID（公钥 + 私钥齐全）。 */
export function isPushConfigured(): boolean {
  return Boolean(getVapidPublicKey() && getVapidPrivateKey());
}

let vapidReady = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  const publicKey = getVapidPublicKey();
  const privateKey = getVapidPrivateKey();
  if (!publicKey || !privateKey) return false;
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:radar@localhost';
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidReady = true;
  return true;
}

/* ------------------------------------------------------------------ */
/* 状态观察（复用现有 Action 推导，零重写判定）                            */
/* ------------------------------------------------------------------ */

function freshnessLabel(f: { status: 'ok' | 'stale' | 'unavailable'; reason: string | null } | null | undefined): string {
  if (!f) return '未知';
  return f.status === 'ok' ? '新鲜' : `${f.status}${f.reason ? `（${f.reason}）` : ''}`;
}

/** 对给定标的推导 Action 观察（纯组装，复用 actionInputFromSignal + deriveActionState）。 */
export function collectActionObservations(overview: MarketOverview, symbols: string[]): ActionObservation[] {
  const out: ActionObservation[] = [];
  for (const symbol of symbols) {
    const sig = overview.signals[symbol] ?? null;
    const px = overview.prices[symbol] ?? null;
    const fresh = overview.freshnessByCoin?.[symbol] ?? overview.freshness;
    const input = actionInputFromSignal(sig, {
      asset: symbol,
      price: px?.last ?? null,
      priceTs: px?.ts ?? null,
      forcedStatus: fresh?.status,
      staleReason: fresh?.reason ?? null,
    });
    const action = deriveActionState(input).code;
    out.push({
      symbol,
      action,
      episodeId: sig?.breakout?.episodeId ?? null,
      price: px?.last ?? null,
      freshnessLabel: freshnessLabel(fresh),
      breakoutLevel: sig?.breakout?.level ?? sig?.keyLevels?.breakoutLevel ?? null,
      invalidationLevel: sig?.keyLevels?.invalidation ?? null,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 发送                                                                 */
/* ------------------------------------------------------------------ */

export interface PushSendResult {
  sent: number;
  removed: number;
  failed: number;
}

/** 向全部已订阅终端发送同一 payload；404/410 清理失效订阅，其余失败只记日志。 */
export async function sendPushToAll(payload: PushPayload): Promise<PushSendResult> {
  const result: PushSendResult = { sent: 0, removed: 0, failed: 0 };
  if (!ensureVapid()) return result;
  const db = tryOpenDb();
  if (!db) return result;
  const subs = readPushSubscriptions(db);
  const body = JSON.stringify(payload);
  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        body,
      );
      result.sent += 1;
    } catch (err) {
      const statusCode = (err as { statusCode?: number } | null | undefined)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        try {
          if (deletePushSubscription(db, sub.endpoint)) result.removed += 1;
        } catch {
          console.error('[push] 清理失效订阅失败', sub.endpoint);
        }
      } else {
        result.failed += 1;
        console.error(`[push] 发送失败 endpoint=${sub.endpoint} status=${statusCode ?? 'n/a'}`);
      }
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* 检查循环                                                              */
/* ------------------------------------------------------------------ */

export interface PushCheckSummary {
  symbols: number;
  edges: number;
  sent: number;
  failed: number;
  removed: number;
  /** 本轮未发送的原因（用于可观测性，非错误）。 */
  skipped: 'vapid-not-configured' | 'db-unavailable' | 'no-subscriptions' | 'baseline' | null;
}

let timer: ReturnType<typeof setInterval> | null = null;
let prevActions: Record<string, ActionCode | undefined> = {};
let haveBaseline = false;
const seenKeys = new Set<string>();

/**
 * 执行一轮检查：拉 overview → 推导 Action → 边沿检测 → 过滤 → 发送。
 * 单轮幂等；异常由调用方捕获，不影响进程。
 */
export async function runPushCheckOnce(): Promise<PushCheckSummary> {
  const summary: PushCheckSummary = { symbols: 0, edges: 0, sent: 0, failed: 0, removed: 0, skipped: null };
  if (!isPushConfigured()) {
    summary.skipped = 'vapid-not-configured';
    return summary;
  }
  const db = tryOpenDb();
  if (!db) {
    summary.skipped = 'db-unavailable';
    return summary;
  }
  if (!readPushSubscriptions(db).length) {
    // 无订阅：不拉行情，清空基线；下次订阅后冷启动只做基线（不重报当前状态）。
    prevActions = {};
    haveBaseline = false;
    summary.skipped = 'no-subscriptions';
    return summary;
  }

  const overview = await getMarketOverview();
  const symbols = getEnabledAssets(getServerRegistry()).map((a) => a.id);
  summary.symbols = symbols.length;
  const observations = collectActionObservations(overview, symbols);

  if (!haveBaseline) {
    // 冷启动：只建立基线，不推送（避免进程重启把当前状态整批重报）。
    prevActions = Object.fromEntries(observations.map((o) => [o.symbol, o.action]));
    haveBaseline = true;
    summary.skipped = 'baseline';
    return summary;
  }

  const { edges, next } = detectActionEdges(prevActions, observations);
  prevActions = next;
  summary.edges = edges.length;

  const pushable = selectPushableEdges(edges, { subscriptions: DEFAULT_SUBSCRIPTIONS, seenKeys });
  for (const edge of pushable) {
    const payload = buildPushPayload(edge);
    if (!payload) continue;
    const res = await sendPushToAll(payload);
    summary.sent += res.sent;
    summary.failed += res.failed;
    summary.removed += res.removed;
    // 至少发出一条才算已推送（全失败时下轮可重试）；去重键上限保护内存。
    if (res.sent > 0) {
      seenKeys.add(buildPushKey(edge.symbol, edge.episodeId, edge.action));
      if (seenKeys.size > SEEN_KEYS_LIMIT) {
        const first = seenKeys.values().next().value;
        if (first !== undefined) seenKeys.delete(first);
      }
    }
  }
  return summary;
}

/** 随 server 启动检查循环；未配置 VAPID 时只记日志并跳过（不崩进程）。 */
export function startPushCheckLoop(intervalMs?: number): void {
  if (timer) return;
  if (!isPushConfigured()) {
    console.warn('[push] 未配置 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY，跳过推送检查循环。');
    return;
  }
  const envMs = Number(process.env.PUSH_CHECK_INTERVAL_MS);
  const interval = intervalMs ?? (Number.isFinite(envMs) && envMs > 0 ? envMs : DEFAULT_INTERVAL_MS);
  timer = setInterval(() => {
    runPushCheckOnce().catch((err) => console.error('[push] 检查循环异常（不影响进程）', err));
  }, interval);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[push] 推送检查循环已启动，间隔 ${interval}ms。`);
}

export function stopPushCheckLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** 仅测试：重置循环内存基线/去重键，避免用例间串状态。 */
export function resetPushCheckStateForTests(): void {
  prevActions = {};
  haveBaseline = false;
  seenKeys.clear();
}
