/**
 * Alert Center 报警中心（Phase B，纯函数 + 可测逻辑层，无 DOM/Audio/Notification 副作用）。
 *
 * 边界（冻结，不可违反）：
 * - 只监听现有 Action/Episode/HardVeto/Freshness，不创造新信号；不读 MFE/MAE/Outcome/Test
 *  （禁未来数据；本模块 import 禁止出现 mfe-mae/backtest/samples/event-metrics）。
 * - 不改任何策略/权重/阈值/HardVeto/Rolling42/Episode/Walkforward/M5/holdout 判定逻辑，
 *   只消费 action.ts / market-service 已算好的 ActionCode + episodeId + freshness。
 * - 禁买入/胜率/概率/必涨话术（见 ALERT_COPY，测试 B-TEST 覆盖）。
 * - 可靠性 10 原则（R1-R10，见各函数注释）：
 *   R1 只消费现有信号；R2 状态变化才建 Alert（prev!=cur）；R3 同 alertKey 只建一个
 *   （刷新/轮询/重挂载禁重复）；R4 ACK 持久化后同 episode+state 禁再报；R5 状态机由事件
 *   驱动，禁 mount 决定生命周期；R6 队列堆叠禁覆盖；R7 历史上限 50 条；R8 声/光副作用
 *   必须用户手势初始化，禁静默失败；R9 关页停检诚实声明（无 Web Push）；R10 禁未来数据。
 */

import type { ActionCode } from './action';
import { formatPrice } from './format';

/* ------------------------------------------------------------------ */
/* 订阅                                                                */
/* ------------------------------------------------------------------ */

/** 可订阅的 Action 状态（NO_ACTION 永不报警，只作内部过滤）。 */
export type SubscribableAction = 'BREAKOUT_TRACK' | 'RETEST_WATCH' | 'REJECT' | 'DATA_BLOCKED' | 'WATCH' | 'OVERHEATED';

/** 订阅中文标签（C1：只改显示，英文 key 不变）。 */
export const SUBSCRIPTION_LABELS: Record<SubscribableAction, string> = {
  BREAKOUT_TRACK: '突破跟踪',
  RETEST_WATCH: '回踩观察',
  REJECT: '本轮结束',
  DATA_BLOCKED: '数据不足',
  WATCH: '蓄势观察',
  OVERHEATED: '位置过热',
};

/** 默认订阅：BREAKOUT_TRACK/RETEST_WATCH/REJECT/DATA_BLOCKED 开，WATCH 关，OVERHEATED 可选（默认关）。 */
export const DEFAULT_SUBSCRIPTIONS: Record<SubscribableAction, boolean> = {
  BREAKOUT_TRACK: true,
  RETEST_WATCH: true,
  REJECT: true,
  DATA_BLOCKED: true,
  WATCH: false,
  OVERHEATED: false,
};

export type AlertCoin = 'PEPE' | 'DOGE';

/* ------------------------------------------------------------------ */
/* 严重级别                                                             */
/* ------------------------------------------------------------------ */

export type AlertSeverity = 'INFO' | 'WATCH' | 'IMPORTANT' | 'CRITICAL';

/** Action → 严重级别（固定映射，禁用户误配为概率含义）。 */
export const ACTION_SEVERITY: Record<SubscribableAction, AlertSeverity> = {
  WATCH: 'WATCH',
  OVERHEATED: 'WATCH',
  DATA_BLOCKED: 'INFO',
  BREAKOUT_TRACK: 'IMPORTANT',
  RETEST_WATCH: 'IMPORTANT',
  REJECT: 'CRITICAL',
};

/* ------------------------------------------------------------------ */
/* 文案（说人话，禁买入/胜率/概率/必涨）                                  */
/* ------------------------------------------------------------------ */

export interface AlertCopy {
  title: string;
  body: string;
}

/**
 * 各状态标题正文（§29-34 口径）：只描述"当前结构是什么 + 关键价格 + 新鲜度"，
 * 不给操作指令。调用方用 buildAlertBody 追加价格位 + Freshness。
 */
export const ALERT_COPY: Record<SubscribableAction, AlertCopy> = {
  BREAKOUT_TRACK: {
    title: '突破跟踪：已收盘确认，开始观察后续',
    body: '本轮已出现有效 4H 收盘突破，结构暂有效。接下来看能否站稳突破位，跌破失效位则本轮结束。',
  },
  RETEST_WATCH: {
    title: '回踩观察：价格回到突破区附近',
    body: '突破后价格回到突破区附近且仍守住结构。这是值得重点观察的阶段，仍需后续收盘确认。',
  },
  REJECT: {
    title: '本轮结束：结构已失效或环境不允许',
    body: '本轮突破结构已失效，或市场环境不允许继续跟踪。不沿用旧判断，等新的独立突破再看。',
  },
  DATA_BLOCKED: {
    title: '数据不足：暂停判断，不沿用旧信号',
    body: '实时数据缺失或已过期，当前无法判断。已停止输出行动候选，数据恢复后再评估。',
  },
  WATCH: {
    title: '加入观察：出现蓄势，但尚未突破',
    body: '出现部分蓄势特征，值得继续观察。必须等待有效 4H 收盘突破确认，现在不是突破。',
  },
  OVERHEATED: {
    title: '结构有效，但位置已过热',
    body: '结构仍有效，但当前价格距离原突破位较远，继续跟踪的性价比下降。不代表行情不能继续。',
  },
};

/** 文案禁语（买入/胜率/概率/必涨类），测试逐条断言不出现。 */
export const BANNED_COPY_WORDS = ['买入', '卖出', '开仓', '胜率', '概率', '必涨', '必跌', '保证', '稳赚', '全仓', '加仓'];

export function buildAlertBody(
  action: SubscribableAction,
  price: number | null,
  freshnessLabel: string,
  levels?: { breakoutLevel?: number | null; invalidationLevel?: number | null },
): string {
  const base = ALERT_COPY[action].body;
  const pricePart = price != null ? `当前价格 ${formatPrice(price)}。` : '当前价格未知。';
  // C2：本轮突破位与结构失效位来自现有 Episode 信号（调用方传入 sig.breakout.level / sig.keyLevels.invalidation），
  // 无数据时诚实写"未知/待确认"，禁编数字。
  const fmt = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? formatPrice(v) : '未知（待确认）');
  const levelPart = levels
    ? `本轮突破位 ${fmt(levels.breakoutLevel)}；结构失效位 ${fmt(levels.invalidationLevel)}。`
    : '';
  return `${base}${pricePart}${levelPart}数据状态：${freshnessLabel}。`;
}

/* ------------------------------------------------------------------ */
/* alertKey / 建 Alert 判定（R2/R3）                                     */
/* ------------------------------------------------------------------ */

/** 同键只建一个：symbol + episodeId + actionState。 */
export function buildAlertKey(coin: AlertCoin, episodeId: string | null, action: ActionCode): string {
  return `${coin}|${episodeId ?? 'no-episode'}|${action}`;
}

export interface AlertInput {
  coin: AlertCoin;
  prevAction: ActionCode | null;
  curAction: ActionCode;
  episodeId: string | null;
  price: number | null;
  freshnessLabel: string;
  subscriptions: Record<SubscribableAction, boolean>;
  /** 已存在的 alertKey 集合（刷新/轮询/重挂载去重，R3）。 */
  existingKeys: Set<string> | string[];
  /** 已 ACK 的 alertKey 集合（R4：同 episode+state ACK 后禁再报）。 */
  ackedKeys: Set<string> | string[];
}

/** 是否在订阅内（含 NO_ACTION 永不报警）。 */
export function isSubscribable(action: ActionCode): action is SubscribableAction {
  return action in DEFAULT_SUBSCRIPTIONS;
}

/**
 * 状态变化才建 Alert（R2：prev!=cur 且在订阅内），且同键只建一个（R3），
 * 且同 episode+state ACK 后禁再报（R4：离后重入或新 Episode 才允许，即 key 不同才允许）。
 */
export function shouldCreateAlert(input: AlertInput): { create: boolean; key: string; reason: string } {
  const key = buildAlertKey(input.coin, input.episodeId, input.curAction);
  const has = (s: Set<string> | string[], k: string) => (Array.isArray(s) ? s.includes(k) : s.has(k));
  if (!isSubscribable(input.curAction)) return { create: false, key, reason: 'not-subscribable' };
  if (!input.subscriptions[input.curAction]) return { create: false, key, reason: 'unsubscribed' };
  if (input.prevAction === input.curAction) return { create: false, key, reason: 'no-state-change' };
  if (has(input.existingKeys, key)) return { create: false, key, reason: 'duplicate-key' };
  if (has(input.ackedKeys, key)) return { create: false, key, reason: 'acked' };
  return { create: true, key, reason: 'ok' };
}

/* ------------------------------------------------------------------ */
/* 状态机 IDLE/TRIGGERED/ACTIVE/ACKNOWLEDGED/AUTO_DISMISSED/EXPIRED      */
/* ------------------------------------------------------------------ */

export type AlertLifecycle = 'IDLE' | 'TRIGGERED' | 'ACTIVE' | 'ACKNOWLEDGED' | 'AUTO_DISMISSED' | 'EXPIRED';

export type AlertEvent =
  | { type: 'TRIGGER' }
  | { type: 'SHOW' }
  | { type: 'ACK' }
  | { type: 'AUTO_DISMISS_TIMEOUT' }
  | { type: 'EXPIRE' }
  | { type: 'RESET' };

/**
 * 状态机（R5：禁 mount 决定生命周期，只能由事件驱动）。
 * IDLE --TRIGGER--> TRIGGERED --SHOW--> ACTIVE --ACK--> ACKNOWLEDGED
 * ACTIVE --AUTO_DISMISS_TIMEOUT--> AUTO_DISMISSED --EXPIRE--> EXPIRED（历史保留）
 * 任何态 --RESET--> IDLE（仅测试/新一轮 episode 用）。
 * Esc 禁当 ACK（UI 层只许暂停声音，见组件注释；此处无 ESC 事件）。
 */
export function nextAlertLifecycle(cur: AlertLifecycle, ev: AlertEvent): AlertLifecycle {
  switch (cur) {
    case 'IDLE':
      return ev.type === 'TRIGGER' ? 'TRIGGERED' : cur;
    case 'TRIGGERED':
      if (ev.type === 'SHOW') return 'ACTIVE';
      if (ev.type === 'RESET') return 'IDLE';
      return cur;
    case 'ACTIVE':
      if (ev.type === 'ACK') return 'ACKNOWLEDGED';
      if (ev.type === 'AUTO_DISMISS_TIMEOUT') return 'AUTO_DISMISSED';
      if (ev.type === 'EXPIRE') return 'EXPIRED';
      return cur;
    case 'AUTO_DISMISSED':
      if (ev.type === 'ACK') return 'ACKNOWLEDGED';
      if (ev.type === 'EXPIRE') return 'EXPIRED';
      if (ev.type === 'RESET') return 'IDLE';
      return cur;
    case 'ACKNOWLEDGED':
      if (ev.type === 'EXPIRE') return 'EXPIRED';
      if (ev.type === 'RESET') return 'IDLE';
      return cur;
    case 'EXPIRED':
      return ev.type === 'RESET' ? 'IDLE' : cur;
    default:
      return cur;
  }
}

/* ------------------------------------------------------------------ */
/* 持续模式 UNTIL_ACK / AUTO_DISMISS                                    */
/* ------------------------------------------------------------------ */

export type DismissMode = 'UNTIL_ACK' | 'AUTO_DISMISS';
export const DISMISS_MODE_LABELS: Record<DismissMode, string> = {
  UNTIL_ACK: '需手动确认',
  AUTO_DISMISS: '倒计时自动关闭',
};
export type AutoDismissSecs = 10 | 30 | 60;
export const AUTO_DISMISS_OPTIONS: AutoDismissSecs[] = [10, 30, 60];

/** AUTO 下循环不超关闭时间：剩余声循环次数上限 = ceil(关闭秒数 / 单次时长)。 */
export function maxSoundLoops(autoSecs: AutoDismissSecs, singleLoopSecs: number): number {
  if (!Number.isFinite(singleLoopSecs) || singleLoopSecs <= 0) return 1;
  return Math.max(1, Math.ceil(autoSecs / singleLoopSecs));
}

/** 倒计时剩余秒（纯函数，UI 每秒调用）。 */
export function countdownLeft(totalSecs: number, elapsedSecs: number): number {
  return Math.max(0, Math.ceil(totalSecs - elapsedSecs));
}

/* ------------------------------------------------------------------ */
/* 声音 Pattern                                                         */
/* ------------------------------------------------------------------ */

export type SoundPattern = 'ONCE' | 'DOUBLE' | 'TRIPLE' | 'INTERVAL' | 'CONTINUOUS_UNTIL_ACK';
export const SOUND_PATTERNS: SoundPattern[] = ['ONCE', 'DOUBLE', 'TRIPLE', 'INTERVAL', 'CONTINUOUS_UNTIL_ACK'];

/** Pattern 中文标签（C1：只改显示，英文 value 不变）。 */
export const SOUND_PATTERN_LABELS: Record<SoundPattern, string> = {
  ONCE: '响一次',
  DOUBLE: '响两次',
  TRIPLE: '响三次',
  INTERVAL: '间隔重复',
  CONTINUOUS_UNTIL_ACK: '持续到确认',
};

/**
 * C3：CONTINUOUS 真持续鸣响间隔（ms）。有限 Pattern 仍走 planPattern；
 * CONTINUOUS 由 UI 层用 setInterval 按此间隔循环直到 ACK/超时/Esc 取消。
 */
export const CONTINUOUS_SOUND_INTERVAL_MS = 1200;

/** Pattern 计划：返回每次鸣响相对延迟（ms）。INTERVAL/CONTINUOUS 由调用方按关闭时间截断。 */
export function planPattern(pattern: SoundPattern, opts?: { intervalMs?: number; maxRepeats?: number }): number[] {
  const gap = opts?.intervalMs ?? 1200;
  switch (pattern) {
    case 'ONCE':
      return [0];
    case 'DOUBLE':
      return [0, 600];
    case 'TRIPLE':
      return [0, 600, 1200];
    case 'INTERVAL':
      return [0, gap, gap * 2];
    case 'CONTINUOUS_UNTIL_ACK':
      return [0, gap, gap * 2, gap * 3];
  }
}

/* ------------------------------------------------------------------ */
/* 表现通道                                                             */
/* ------------------------------------------------------------------ */

export type DisplayChannel = 'modal' | 'banner' | 'system' | 'tabflash' | 'cardpulse';
export const DISPLAY_CHANNELS: DisplayChannel[] = ['modal', 'banner', 'system', 'tabflash', 'cardpulse'];

/** 通道中文标签（C1：只改显示，英文 key 不变）。 */
export const DISPLAY_CHANNEL_LABELS: Record<DisplayChannel, string> = {
  modal: '弹窗',
  banner: '横幅',
  system: '系统通知',
  tabflash: '标签页闪烁',
  cardpulse: '卡片脉冲',
};

/* ------------------------------------------------------------------ */
/* 测试报警隔离（QA：测试态与真实态隔离）                                */
/* ------------------------------------------------------------------ */

/**
 * 测试报警专用 episodeId：测试报警只允许走隔离预览路径。
 * - 标 TEST：标题含"测试报警"，episodeId 固定为 test-episode；
 * - 禁写真实 Alert History（见 pushHistory 守卫）；
 * - 禁改 Market State（UI 层 sendTest 禁碰 prevRef/seenKeys/acked，见组件注释）。
 */
export const TEST_ALERT_EPISODE_ID = 'test-episode';

/** 是否测试报警键（含 test-episode 即视为测试键）。 */
export function isTestAlertKey(alertKey: string): boolean {
  return alertKey.includes(TEST_ALERT_EPISODE_ID);
}

/** 是否测试报警记录（键/ episodeId /标题三者任一命中即隔离）。 */
export function isTestAlertRecord(rec: Pick<AlertRecord, 'alertKey' | 'episodeId' | 'title'>): boolean {
  return (
    rec.episodeId === TEST_ALERT_EPISODE_ID ||
    isTestAlertKey(rec.alertKey) ||
    rec.title.includes('测试报警')
  );
}

/* ------------------------------------------------------------------ */
/* 历史 50 条（11 字段 + DARK 原因）                                      */
/* ------------------------------------------------------------------ */

/**
 * 历史 11 字段：
 * 1 alertKey / 2 coin / 3 episodeId / 4 actionCode / 5 severity /
 * 6 title / 7 body / 8 price / 9 freshnessLabel / 10 createdAt / 11 lifecycle
 * + DARK 原因（darkReason，仅 DATA_BLOCKED/REJECT 数据分支有值，其余 null）。
 */
export interface AlertRecord {
  alertKey: string;
  coin: AlertCoin;
  episodeId: string | null;
  actionCode: ActionCode;
  severity: AlertSeverity;
  title: string;
  body: string;
  price: number | null;
  freshnessLabel: string;
  createdAt: number;
  lifecycle: AlertLifecycle;
  darkReason: string | null;
}

export const ALERT_HISTORY_LIMIT = 50;

/** 队列堆叠禁覆盖（R6）：append 后按 createdAt 截断到 50 条（保留最新）。
 * 去重：同 alertKey 已在历史中则直接返回原列表（不重复 append，不消耗上限；
 * 调用方另以 seen 键集合防“截断丢键后重报”，见 AlertCenterHost）。
 * 隔离：测试报警记录（见 isTestAlertRecord）直接拒收，禁写真实历史。 */
export function pushHistory(list: AlertRecord[], rec: AlertRecord, limit = ALERT_HISTORY_LIMIT): AlertRecord[] {
  if (isTestAlertRecord(rec)) return list;
  if (list.some((r) => r.alertKey === rec.alertKey)) return list;
  const next = [...list, rec];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/* ------------------------------------------------------------------ */
/* 设置                                                                  */
/* ------------------------------------------------------------------ */

export interface AlertSettings {
  masterEnabled: boolean;
  coins: Record<AlertCoin, boolean>;
  subscriptions: Record<SubscribableAction, boolean>;
  dismissMode: DismissMode;
  autoDismissSecs: AutoDismissSecs;
  selectedSoundId: string;
  pattern: SoundPattern;
  volume: number; // 0-100
  muted: boolean;
  channels: Record<DisplayChannel, boolean>;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  masterEnabled: true,
  coins: { PEPE: true, DOGE: true },
  subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
  dismissMode: 'AUTO_DISMISS',
  autoDismissSecs: 30,
  selectedSoundId: 'chime-soft',
  pattern: 'DOUBLE',
  volume: 40, // 默认不大
  muted: false,
  channels: { modal: true, banner: true, system: false, tabflash: true, cardpulse: true },
};

export function sanitizeSettings(raw: Omit<Partial<AlertSettings>, 'subscriptions' | 'coins' | 'channels'> & { subscriptions?: Partial<Record<SubscribableAction, boolean>>; coins?: Partial<Record<AlertCoin, boolean>>; channels?: Partial<Record<DisplayChannel, boolean>> }): AlertSettings {
  const v = { ...DEFAULT_ALERT_SETTINGS, ...raw };
  const vol = typeof v.volume === 'number' && Number.isFinite(v.volume) ? Math.round(v.volume) : 40;
  return {
    ...v,
    volume: Math.min(100, Math.max(0, vol)),
    autoDismissSecs: ([10, 30, 60] as AutoDismissSecs[]).includes(v.autoDismissSecs) ? v.autoDismissSecs : 30,
    subscriptions: { ...DEFAULT_SUBSCRIPTIONS, ...(raw.subscriptions ?? {}) },
    coins: { PEPE: true, DOGE: true, ...(raw.coins ?? {}) },
    channels: {
      modal: true,
      banner: true,
      system: false,
      tabflash: true,
      cardpulse: true,
      ...(raw.channels ?? {}),
    },
  };
}

/* ------------------------------------------------------------------ */
/* 存储键                                                                */
/* ------------------------------------------------------------------ */

export const ALERT_STORE_KEYS = {
  settings: 'radar.alert.settings.v1',
  acked: 'radar.alert.acked.v1',
  history: 'radar.alert.history.v1',
} as const;

/* ------------------------------------------------------------------ */
/* 能力边界（诚实写）                                                     */
/* ------------------------------------------------------------------ */

/** 无 Web Push：页面关闭/浏览器退出后停止检查（轮询只在页面存活时进行）。 */
export const CAPABILITY_NOTE =
  '提醒只在页面打开时检查（随前端轮询触发），无 Web Push；页面关闭或浏览器退出后停止检查，历史与 ACK 保留在本地。';
