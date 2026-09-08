/**
 * Action Card（当前行动）决策解释层（UX Layer）。
 *
 * 定位：把 V2 量化状态翻译成「用户现在应该怎么关注这个币」，
 * 回答淘汰 / 观察 / 跟踪中的哪一个、为什么、关键价格、什么会改变判断。
 *
 * 科学边界（冻结，不可违反）：
 * - 不输出开仓/买入/胜率/推荐语；M1–M4 尚未证明样本外增量，M5 仅为候选方向。
 * - Setup 高分只能解释「进入观察名单」，不能产生 BREAKOUT_TRACK / RETEST_WATCH。
 * - Trigger 高分只解释「当时突破结构较完整」，不代表未来收益概率。
 * - 实时 Action 绝不消费未来 Outcome Label（本函数签名中根本没有 outcome 字段）。
 * - DATA_VETO / 数据缺失一律走 DATA_BLOCKED，不沿用旧信号。
 *
 * 本模块是纯函数（deterministic mapping），页面只负责 render。
 * 本轮未修改任何底层量化策略与阈值；OVERHEATED/WEAK 等展示分档为
 * display-only（见注释），不是交易阈值，未经回测，不做预测宣称。
 */
import { DEFAULT_CONFIG } from './config';
import type { AssetId, AssetSignal, EnvironmentGate, HardVetoKind, ScoreStatus, StateCode } from './types';

export type ActionCode =
  | 'REJECT'
  | 'WATCH'
  | 'BREAKOUT_TRACK'
  | 'RETEST_WATCH'
  | 'OVERHEATED'
  | 'DATA_BLOCKED'
  | 'NO_ACTION';

export type ActionSeverity = 'danger' | 'warn' | 'ok' | 'info' | 'muted' | 'dark';

export interface ActionReason {
  ok: boolean;
  text: string;
}

export interface NextCondition {
  /** 例如："4H 收盘跌破 0.0896"（level 另存 raw，供 UI 精确格式化）。 */
  condition: string;
  /** 例如："本轮结构失效"。 */
  outcome: string;
  level: number | null;
}

export interface ActionKeyLevels {
  currentPrice: number | null;
  /** 本轮 Independent Breakout Episode 当时突破的关键阻力。 */
  breakoutLevel: number | null;
  /** 跌破后本轮结构失效。 */
  invalidationLevel: number | null;
  /** 最新滚动窗口的下一关键阻力。 */
  nextResistance: number | null;
  /** 突破当根超越幅度（breakoutClose 相对 breakoutLevel）。 */
  breakoutExtensionPct: number | null;
  /** 当前价格相对 breakoutLevel 的距离（与上者禁止混用）。 */
  currentDistancePct: number | null;
  /** 本轮突破距今小时数（解释信息，不做失效判定）。 */
  episodeAgeHours: number | null;
}

export interface ActionHistory {
  setupScore: number | null;
  triggerScore: number | null;
  followThroughText: string;
  /** true = 历史突破评分，仅用于复盘，UI 必须灰化。 */
  historicalOnly: boolean;
}

export interface ActionEntryHeat {
  value: number | null;
  band: '低' | '中' | '高' | '未知';
}

export interface ActionState {
  code: ActionCode;
  emoji: string;
  title: string;
  severity: ActionSeverity;
  summary: string;
  reasons: ActionReason[];
  warnings: string[];
  keyLevels: ActionKeyLevels;
  nextConditions: NextCondition[];
  history: ActionHistory;
  entryHeat: ActionEntryHeat;
  /** episode 状态解释（例如本轮已失效，等待新 episode）。 */
  episodeStatus: string | null;
  dataFreshness: { status: 'ok' | 'stale' | 'unavailable'; lastUpdatedTs: number | null; reason: string | null };
}

export interface ActionInput {
  dataStatus: 'ok' | 'stale' | 'unavailable';
  lastUpdatedTs: number | null;
  staleReason: string | null;
  environmentGate: EnvironmentGate;
  hardVetoKind: HardVetoKind;
  hardVetoReason: string | null;
  state: StateCode;
  /** Entry Heat（原 Risk 值 0–100，越高越过热）。 */
  entryHeat: number | null;
  currentPrice: number | null;
  breakoutConfirmed: boolean;
  breakoutLevel: number | null;
  breakoutClose: number | null;
  /** 突破当根超越幅度（%。 */
  breakoutExtensionPct: number | null;
  /** 当前价格相对 breakoutLevel 的距离（%）。 */
  currentDistancePct: number | null;
  invalidationLevel: number | null;
  nextResistance: number | null;
  breakoutTs: number | null;
  episodeAgeHours: number | null;
  episodeId: string | null;
  heldAboveBreakoutLevel: boolean | null;
  setupScore: number | null;
  triggerScore: number | null;
  followThroughStatus: ScoreStatus;
  followThroughValue: number | null;
}

export const ACTION_META: Record<ActionCode, { emoji: string; title: string; severity: ActionSeverity }> = {
  REJECT: { emoji: '🔴', title: '当前淘汰', severity: 'danger' },
  WATCH: { emoji: '🟡', title: '加入观察', severity: 'warn' },
  BREAKOUT_TRACK: { emoji: '🟢', title: '突破跟踪', severity: 'ok' },
  RETEST_WATCH: { emoji: '🔵', title: '回踩重点观察', severity: 'info' },
  OVERHEATED: { emoji: '🟠', title: '结构有效，但已过热', severity: 'warn' },
  DATA_BLOCKED: { emoji: '⚫', title: '数据不足，暂停判断', severity: 'dark' },
  NO_ACTION: { emoji: '⚪', title: '暂无行动', severity: 'muted' },
};

/** Entry Heat 展示分档（display-only：仅决定「低/中/高」文案，不做任何交易判定）。 */
export const ENTRY_HEAT_HIGH = 70;
export const ENTRY_HEAT_MID = 40;

export const ENTRY_HEAT_COPY = {
  label: 'Entry Heat · 追高 / 过热风险',
  tooltip:
    '衡量当前价格是否距离原突破位过远、短期是否过热或拥挤。它不代表这笔交易的全部风险。Hard Veto 和结构失效拥有更高优先级。',
} as const;

export const TRIGGER_COPY = {
  tooltip: 'Trigger 衡量已发生突破在量能、K 线结构和相对强度上的完整程度，不代表未来收益概率。',
} as const;

export const SETUP_COPY = {
  tooltip:
    'Setup 用于筛选值得观察的结构，不作为独立开仓信号。最新样本外评估显示，BUILDING_SETUP / NEAR_BREAKOUT 在普通行情中仍存在较高误报，因此应结合真实突破、Follow-through 和结构有效性使用。',
} as const;

export const FOLLOW_THROUGH_COPY = {
  tooltip: 'Follow-through 当前是最值得继续验证的突破后管理指标，但尚未证明具有稳定的样本外预测优势。',
} as const;

function fmtNum(v: number | null): string {
  if (v == null) return '—';
  return String(v);
}

export type FollowThroughGrade = 'NOT_STARTED' | 'PENDING' | 'WEAK' | 'HEALTHY' | 'FAILED';

/**
 * Follow-through 状态文字（优先展示状态而非分数）。
 * 分档阈值（HEALTHY ≥ 60 / WEAK ≥ 35）为 display-only，不做预测宣称；
 * 缺失数据一律 PENDING，绝不判低分。
 */
export function describeFollowThrough(
  status: ScoreStatus,
  value: number | null,
  heldAbove: boolean | null,
  hoursSince: number | null,
): { grade: FollowThroughGrade; text: string; detail: string } {
  const age = hoursSince != null ? `已观察 ${Math.round(hoursSince)}h` : '观察时长未知';
  if (status === 'NOT_STARTED') return { grade: 'NOT_STARTED', text: 'NOT_STARTED', detail: '突破尚未发生' };
  if (status === 'PENDING' || status === 'WAITING' || status === 'DATA_UNAVAILABLE' || value == null) {
    return {
      grade: 'PENDING',
      text: 'PENDING',
      detail: `突破刚发生或跟随数据不足，尚无足够后续数据判断突破是否健康。${age}。`,
    };
  }
  if (heldAbove === false) return { grade: 'FAILED', text: 'FAILED', detail: `价格已跌回突破位下方。${age}。` };
  if (value >= 60) return { grade: 'HEALTHY', text: 'HEALTHY', detail: `突破后结构保持健康。${age}。` };
  return { grade: 'WEAK', text: 'WEAK', detail: `突破后跟随偏弱，继续观察是否修复。${age}。` };
}

function entryHeatBand(value: number | null): ActionEntryHeat['band'] {
  if (value == null) return '未知';
  if (value >= ENTRY_HEAT_HIGH) return '高';
  if (value >= ENTRY_HEAT_MID) return '中';
  return '低';
}

function emptyLevels(): ActionKeyLevels {
  return {
    currentPrice: null,
    breakoutLevel: null,
    invalidationLevel: null,
    nextResistance: null,
    breakoutExtensionPct: null,
    currentDistancePct: null,
    episodeAgeHours: null,
  };
}

/**
 * 确定性映射：量化状态 → 当前行动（优先级见函数内顺序）。
 * 注意：输入中没有任何未来 outcome 字段；Setup 分只决定是否 WATCH。
 */
export function deriveActionState(input: ActionInput): ActionState {
  const meta = (code: ActionCode): Pick<ActionState, 'code' | 'emoji' | 'title' | 'severity'> => ({
    code,
    emoji: ACTION_META[code].emoji,
    title: ACTION_META[code].title,
    severity: ACTION_META[code].severity,
  });
  const freshness = {
    status: input.dataStatus,
    lastUpdatedTs: input.lastUpdatedTs,
    reason: input.staleReason,
  };
  const levels: ActionKeyLevels = {
    currentPrice: input.currentPrice,
    breakoutLevel: input.breakoutLevel,
    invalidationLevel: input.invalidationLevel,
    nextResistance: input.nextResistance,
    breakoutExtensionPct: input.breakoutExtensionPct,
    currentDistancePct: input.currentDistancePct,
    episodeAgeHours: input.episodeAgeHours,
  };
  const ft = describeFollowThrough(input.followThroughStatus, input.followThroughValue, input.heldAboveBreakoutLevel, input.episodeAgeHours);
  const entryHeat: ActionEntryHeat = { value: input.entryHeat, band: entryHeatBand(input.entryHeat) };
  const historyBase: Omit<ActionHistory, 'historicalOnly'> = {
    setupScore: input.setupScore,
    triggerScore: input.triggerScore,
    followThroughText: input.followThroughValue != null ? `${ft.text} · ${input.followThroughValue}` : ft.text,
  };

  /* 1) DATA_BLOCKED：停止输出候选，不沿用旧信号。 */
  if (input.dataStatus !== 'ok') {
    return {
      ...meta('DATA_BLOCKED'),
      summary: '数据不足，暂停判断。已停止输出行动候选，不沿用旧信号。',
      reasons: [
        { ok: false, text: input.staleReason ?? '实时数据不可用' },
        {
          ok: false,
          text: input.lastUpdatedTs != null ? `最后有效更新：${new Date(input.lastUpdatedTs).toISOString()}` : '无最后有效更新时间',
        },
      ],
      warnings: [],
      keyLevels: emptyLevels(),
      nextConditions: [{ condition: '数据恢复并完成 4H 收盘更新', outcome: '重新评估当前行动', level: null }],
      history: { ...historyBase, historicalOnly: true },
      entryHeat,
      episodeStatus: null,
      dataFreshness: freshness,
    };
  }

  const envOk = input.environmentGate !== 'BLOCK';
  const vetoName = input.hardVetoKind !== 'NONE' ? input.hardVetoKind : null;

  /* 2) 硬否决 / 环境 / 失效：任何高分都不能覆盖。MARKET_BLOCKED 按状态机定义只来自否决或环境 BLOCK，此处兜底同判。 */
  if (input.hardVetoKind !== 'NONE' || !envOk || input.state === 'FAILED_BREAKOUT' || input.state === 'INVALIDATED' || input.state === 'MARKET_BLOCKED') {
    const why: ActionReason[] = [];
    why.push({
      ok: envOk,
      text: envOk ? 'BTC 环境当前允许' : 'BTC 环境 BLOCK：市场环境不允许跟踪突破',
    });
    if (input.hardVetoKind !== 'NONE') {
      why.push({ ok: false, text: `${input.hardVetoKind} 已触发${input.hardVetoReason ? `：${input.hardVetoReason}` : ''}` });
    }
    why.push({ ok: false, text: '本轮币种结构已失效' });
    if (input.currentPrice != null && input.invalidationLevel != null && input.currentPrice < input.invalidationLevel) {
      why.push({ ok: false, text: `当前价格 ${fmtNum(input.currentPrice)} 已低于结构失效位 ${fmtNum(input.invalidationLevel)}` });
    }
    const ageNote =
      input.episodeAgeHours != null ? `本轮突破发生于约 ${Math.round(input.episodeAgeHours)}h 前，当前结构已经失效。` : '本轮突破结构已经失效。';
    return {
      ...meta('REJECT'),
      summary: `当前价格已经跌破结构失效位，本轮突破结构失效。${ageNote}`,
      reasons: why,
      warnings:
        input.setupScore != null && input.setupScore >= 60
          ? [`Setup ${input.setupScore} / Trigger ${input.triggerScore ?? '—'} 为本轮历史突破评分，仅用于复盘，不代表当前仍可作为突破候选。`]
          : [],
      keyLevels: levels,
      nextConditions: [{ condition: '系统识别到新的 Independent Breakout Episode', outcome: '重新进入观察或跟踪（不沿用旧 episode）', level: null }],
      history: { ...historyBase, historicalOnly: true },
      entryHeat,
      episodeStatus: '本轮 Episode 已失效，等待新的蓄势与 Independent Breakout Episode。',
      dataFreshness: freshness,
    };
  }
  void vetoName;

  const structureValid = input.breakoutConfirmed && input.heldAboveBreakoutLevel !== false;
  const chasePct = DEFAULT_CONFIG.thresholds.chaseDistancePct;

  /* 3) OVERHEATED：结构有效但过热（追高风险提示，不是"不能涨了"）。 */
  const overheated =
    structureValid &&
    (entryHeat.band === '高' ||
      (input.currentDistancePct != null && input.currentDistancePct >= chasePct));
  if (overheated) {
    return {
      ...meta('OVERHEATED'),
      summary: '结构仍有效，但当前价格距离原突破位过远，追高风险较高。',
      reasons: [
        { ok: true, text: 'BTC 环境允许' },
        { ok: true, text: '已完成有效 4H 收盘突破，结构尚未失效' },
        {
          ok: false,
          text:
            entryHeat.band === '高'
              ? `Entry Heat ${input.entryHeat} · 高：短期过热或拥挤`
              : `当前距突破位 ${input.currentDistancePct?.toFixed(2)}%，已超过追涨观察线 ${chasePct}%`,
        },
        { ok: true, text: '尚未触发 Hard Veto' },
      ],
      warnings: ['过热提示只代表当前位置追踪性价比下降，不代表行情不能继续。'],
      keyLevels: levels,
      nextConditions: [
        { condition: '价格重新靠近突破位区域或重新建立 base', outcome: '回到可跟踪结构', level: input.breakoutLevel },
        { condition: `4H 收盘跌破 ${fmtNum(input.invalidationLevel)}`, outcome: '本轮结构失效', level: input.invalidationLevel },
      ],
      history: { ...historyBase, historicalOnly: false },
      entryHeat,
      episodeStatus: input.episodeId ? `跟踪 ${input.episodeId}（episode age ${input.episodeAgeHours != null ? `${Math.round(input.episodeAgeHours)}h` : '未知'}，仅解释信息）。` : null,
      dataFreshness: freshness,
    };
  }

  /* 4) RETEST_WATCH：回踩有效。 */
  if (input.state === 'RETESTING' && structureValid) {
    return {
      ...meta('RETEST_WATCH'),
      summary: '本轮突破后的回踩结构仍然有效，这是当前值得重点观察的阶段。',
      reasons: [
        { ok: true, text: 'BTC 环境允许' },
        { ok: true, text: '已完成有效 4H 收盘突破' },
        { ok: true, text: '当前仍守在本轮突破区域' },
        { ok: true, text: '尚未触发结构失效' },
        { ok: true, text: '尚未触发 Hard Veto' },
      ],
      warnings: ['回踩观察不构成交易信号；Follow-through 仍在验证中。'],
      keyLevels: levels,
      nextConditions: [
        { condition: `守住 ${fmtNum(input.breakoutLevel)} 附近`, outcome: '回踩结构保持有效', level: input.breakoutLevel },
        { condition: `4H 收盘跌破 ${fmtNum(input.invalidationLevel)}`, outcome: '本轮结构失效', level: input.invalidationLevel },
        { condition: `重新突破 ${fmtNum(input.nextResistance)}`, outcome: '进入新的结构观察阶段', level: input.nextResistance },
      ],
      history: { ...historyBase, historicalOnly: false },
      entryHeat,
      episodeStatus: input.episodeId ? `跟踪 ${input.episodeId}（episode age ${input.episodeAgeHours != null ? `${Math.round(input.episodeAgeHours)}h` : '未知'}，仅解释信息）。` : null,
      dataFreshness: freshness,
    };
  }

  /* 5) BREAKOUT_TRACK：有效突破后的跟踪（含 FOLLOW_THROUGH_PENDING / HEALTHY）。 */
  if (
    input.state === 'BREAKOUT_CONFIRMED' ||
    input.state === 'FOLLOW_THROUGH_PENDING' ||
    input.state === 'HEALTHY_BREAKOUT'
  ) {
    const ftNote =
      input.followThroughStatus === 'PENDING' || input.followThroughStatus === 'NOT_STARTED'
        ? '突破刚发生，尚无足够后续数据判断突破是否健康。'
        : `Follow-through：${ft.text}。`;
    return {
      ...meta('BREAKOUT_TRACK'),
      summary: `已完成有效 4H 收盘突破，开始观察 Follow-through。${ftNote}`,
      reasons: [
        { ok: true, text: 'BTC 环境允许' },
        { ok: true, text: '已完成有效 4H 收盘突破' },
        { ok: true, text: '尚未触发结构失效' },
        { ok: true, text: '尚未触发 Hard Veto' },
      ],
      warnings: ['突破跟踪不构成交易信号，不建议据此操作。'],
      keyLevels: levels,
      nextConditions: [
        { condition: '后续 24–48H 站稳突破位', outcome: 'Follow-through 升级', level: input.breakoutLevel },
        { condition: `4H 收盘跌破 ${fmtNum(input.invalidationLevel)}`, outcome: '本轮结构失效', level: input.invalidationLevel },
      ],
      history: { ...historyBase, historicalOnly: false },
      entryHeat,
      episodeStatus: input.episodeId ? `跟踪 ${input.episodeId}（episode age ${input.episodeAgeHours != null ? `${Math.round(input.episodeAgeHours)}h` : '未知'}，仅解释信息）。` : null,
      dataFreshness: freshness,
    };
  }

  /* 6) WATCH：Setup 只能进观察名单。NEAR 也只是"接近阻力区"。 */
  if (input.state === 'NEAR_BREAKOUT' || input.state === 'BUILDING_SETUP') {
    const near = input.state === 'NEAR_BREAKOUT';
    return {
      ...meta('WATCH'),
      summary: near
        ? '接近突破区域，但必须等待有效 4H 收盘确认。值得盯，但不是开仓信号。'
        : '当前出现部分突破前蓄势特征，值得继续观察，不代表已经产生交易信号。',
      reasons: [
        { ok: true, text: 'BTC 环境允许' },
        { ok: true, text: near ? '距离当前阻力已经较近' : '出现部分蓄势结构特征' },
        { ok: false, text: '尚未发生有效 4H 收盘突破' },
      ],
      warnings: [
        'Setup 只用于发现可能的蓄势结构，当前尚未证明具有开仓预测优势。',
        'Setup 在历史普通行情中存在较高误报率（NEAR 约 30%，BUILDING 约 41%），这里只代表值得继续观察。',
      ],
      keyLevels: levels,
      nextConditions: [
        { condition: `4H 收盘突破 ${fmtNum(input.nextResistance)}`, outcome: '进入突破跟踪', level: input.nextResistance },
        { condition: '蓄势结构消散', outcome: '移出观察', level: null },
      ],
      history: { ...historyBase, historicalOnly: false },
      entryHeat,
      episodeStatus: null,
      dataFreshness: freshness,
    };
  }

  /* 7) NO_ACTION：MARKET_BLOCKED 已在上游转为 REJECT；此处兜底。 */
  return {
    ...meta('NO_ACTION'),
    summary: '当前没有值得跟踪的结构，不进入观察。',
    reasons: [{ ok: true, text: '无有效蓄势、无突破、无需跟踪' }],
    warnings: [],
    keyLevels: levels,
    nextConditions: [{ condition: '出现新的蓄势或突破结构', outcome: '重新评估', level: null }],
    history: { ...historyBase, historicalOnly: false },
    entryHeat,
    episodeStatus: null,
    dataFreshness: freshness,
  };
}

/* ------------------------------------------------------------------ */
/* AssetSignal → ActionInput（UI 共用，纯组装，无判定逻辑）             */
/* ------------------------------------------------------------------ */

export interface ActionSourceOpts {
  asset: AssetId;
  price: number | null;
  priceTs: number | null;
  /** 调用方已知的全局状态（unavailable / stale / ok）；默认由 signal 是否存在推导。 */
  forcedStatus?: ActionInput['dataStatus'];
  staleReason?: string | null;
}

/** UI 层唯一入口：页面只负责 render，不写 if/else 判定。 */
export function actionInputFromSignal(signal: AssetSignal | null, opts: ActionSourceOpts): ActionInput {
  if (!signal) {
    return {
      dataStatus: opts.forcedStatus ?? 'unavailable',
      lastUpdatedTs: opts.priceTs,
      staleReason: opts.staleReason ?? '实时信号不可用（未使用任何快照冒充）',
      environmentGate: 'CAUTION',
      hardVetoKind: 'NONE',
      hardVetoReason: null,
      state: 'NO_SETUP',
      entryHeat: null,
      currentPrice: opts.price,
      breakoutConfirmed: false,
      breakoutLevel: null,
      breakoutClose: null,
      breakoutExtensionPct: null,
      currentDistancePct: null,
      invalidationLevel: null,
      nextResistance: null,
      breakoutTs: null,
      episodeAgeHours: null,
      episodeId: null,
      heldAboveBreakoutLevel: null,
      setupScore: null,
      triggerScore: null,
      followThroughStatus: 'NOT_STARTED',
      followThroughValue: null,
    };
  }
  const level = signal.breakout.level;
  return {
    dataStatus: opts.forcedStatus ?? 'ok',
    lastUpdatedTs: opts.priceTs,
    staleReason: opts.staleReason ?? null,
    environmentGate: signal.environment.gate,
    hardVetoKind: signal.hardVeto.kind,
    hardVetoReason: signal.hardVeto.reason,
    state: signal.state,
    entryHeat: signal.risk.status === 'COMPUTED' ? signal.risk.value : null,
    currentPrice: opts.price,
    breakoutConfirmed: signal.breakout.confirmed,
    breakoutLevel: level,
    breakoutClose: signal.breakout.close,
    breakoutExtensionPct: signal.breakout.distancePct,
    currentDistancePct:
      opts.price != null && level != null && level > 0 ? (opts.price / level - 1) * 100 : null,
    invalidationLevel: signal.keyLevels.invalidation,
    nextResistance: signal.keyLevels.resistance,
    breakoutTs: signal.breakout.ts,
    episodeAgeHours: signal.breakout.hoursSinceBreakout,
    episodeId: signal.breakout.episodeId ?? null,
    heldAboveBreakoutLevel: signal.features.heldAboveBreakoutLevel,
    setupScore: signal.setup.status === 'COMPUTED' ? signal.setup.value : null,
    triggerScore: signal.trigger.status === 'COMPUTED' ? signal.trigger.value : null,
    followThroughStatus: signal.followThrough.status,
    followThroughValue: signal.followThrough.status === 'COMPUTED' ? signal.followThrough.value : null,
  };
}
