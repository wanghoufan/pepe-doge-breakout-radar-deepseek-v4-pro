'use client';

/**
 * Alert Center Host（Phase B UI 层）。
 * - 只监听现有 Action/Episode/HardVeto/Freshness（自轮询 /api/market/overview，60s），不创造新信号。
 * - 状态变化才建 Alert，同 alertKey 只建一个；ACK/历史持久化 localStorage。
 * - UNTIL_ACK：Esc 只暂停声音（禁当 ACK），保持 ACTIVE；刷新从 localStorage 恢复 ACTIVE。
 * - AUTO_DISMISS：10/30/60s + 倒计时，超时停声关层但留历史，同状态禁重报。
 * - 声音必须用户点击初始化 AudioContext + 测试音；未解锁显示"点击恢复"，禁静默失败。
 * - Notification 四态 + DENIED 指引禁反复请求；click 聚焦定位 #radar-live。
 * - 能力边界：无 Web Push，关页停检（见 CAPABILITY_NOTE）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ALERT_COPY,
  ALERT_HISTORY_LIMIT,
  ALERT_SEVERITY_STYLES,
  ALERT_STORE_KEYS,
  AUTO_DISMISS_OPTIONS,
  ACTION_SEVERITY,
  CAPABILITY_NOTE,
  CONTINUOUS_SOUND_INTERVAL_MS,
  DEFAULT_ALERT_SETTINGS,
  DISMISS_MODE_LABELS,
  DISPLAY_CHANNELS,
  DISPLAY_CHANNEL_LABELS,
  SOUND_PATTERNS,
  SOUND_PATTERN_LABELS,
  SUBSCRIPTION_LABELS,
  TEST_ALERT_EPISODE_ID,
  buildAlertBody,
  buildAlertKey,
  countdownLeft,
  isSubscribable,
  nextAlertLifecycle,
  planPattern,
  pushHistory,
  sanitizeSettings,
  shouldCreateAlert,
  type AlertCoin,
  type AlertLifecycle,
  type AlertRecord,
  type AlertSettings,
  type AutoDismissSecs,
  type DismissMode,
  type DisplayChannel,
  type SoundPattern,
  type SubscribableAction,
} from '@/lib/alert-center';
import { ALERT_SOUNDS, ensureAudioUnlocked, isAudioUnlocked, playAlertSound, stopAlertSound } from '@/lib/alert-sound';
import { formatTs } from '@/lib/format';
import { actionInputFromSignal, deriveActionState, type ActionCode } from '@/lib/action';
import type { AssetSignal } from '@/lib/types';

interface OverviewPoll {
  status: 'live' | 'unavailable';
  generatedAt: number;
  freshness?: { status: 'ok' | 'stale' | 'unavailable'; reason: string | null } | null;
  error?: string | null;
  data: {
    pepe: AssetSignal | null;
    doge: AssetSignal | null;
    ethfi?: AssetSignal | null;
    prices: Record<'PEPE' | 'DOGE' | 'BTC' | 'ETHFI', { last: number; ts: number } | null>;
  };
}

interface ActiveAlert extends AlertRecord {
  lifecycle: AlertLifecycle;
  shownAt: number;
  soundPaused: boolean;
  preview?: boolean;
}

const POLL_MS = 60_000;

/** seen 键集合上限（防截断丢键后重报；ACK 持久化不动，另键存储）。 */
const SEEN_KEYS_LIMIT = 500;
const SEEN_KEYS_STORE_KEY = `${ALERT_STORE_KEYS.history}.seenKeys`;

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function freshnessLabelOf(o: OverviewPoll | null): string {
  if (!o) return '未知';
  if (o.freshness) return o.freshness.status === 'ok' ? '新鲜' : `${o.freshness.status}${o.freshness.reason ? `（${o.freshness.reason}）` : ''}`;
  return o.status;
}

type NotifyState = 'granted' | 'denied' | 'default' | 'unsupported';

function notifyState(): NotifyState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotifyState;
}

export function AlertCenterHost() {
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_ALERT_SETTINGS);
  const [active, setActive] = useState<ActiveAlert[]>([]);
  const [history, setHistory] = useState<AlertRecord[]>([]);
  const [acked, setAcked] = useState<string[]>([]);
  const [seenKeys, setSeenKeys] = useState<string[]>([]);
  const [audioLocked, setAudioLocked] = useState(true);
  const [notifyPerm, setNotifyPerm] = useState<NotifyState>('default');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // HIGH-1：多 ACTIVE 队列位（Modal 逐个处理）+ 横幅折叠开关（上限外聚合）。
  const [modalIdx, setModalIdx] = useState(0);
  const [bannersExpanded, setBannersExpanded] = useState(false);
  const [tick, setTick] = useState(0);
  const prevRef = useRef<Record<AlertCoin, ActionCode | null>>({ PEPE: null, DOGE: null, ETHFI: null });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // 恢复持久化（R5：mount 只恢复，不决定生命周期新事件）。
  useEffect(() => {
    setSettings(sanitizeSettings(loadJSON(ALERT_STORE_KEYS.settings, DEFAULT_ALERT_SETTINGS)));
    const rawAcked = loadJSON<string[]>(ALERT_STORE_KEYS.acked, []);
    const rawHistory = loadJSON<AlertRecord[]>(ALERT_STORE_KEYS.history, []);
    const rawSeen = loadJSON<string[]>(SEEN_KEYS_STORE_KEY, []);
    setAcked(rawAcked);
    setHistory(rawHistory);
    // seen 键集合：历史截断到 50 条后旧键仍保留于此，非 ACK 旧键不重报（ACK 键不动）。
    setSeenKeys(
      Array.from(new Set([...rawSeen, ...rawAcked, ...rawHistory.map((h) => h.alertKey)])).slice(-SEEN_KEYS_LIMIT),
    );
    const restored = loadJSON<ActiveAlert[]>(`${ALERT_STORE_KEYS.history}.active`, []);
    // 隔离：历史遗留的测试预览（preview）不恢复，只恢复真实 ACTIVE。
    setActive(restored.filter((a) => a.lifecycle === 'ACTIVE' && !a.preview).map((a) => ({ ...a, soundPaused: false })));
    setAudioLocked(!isAudioUnlocked());
    setNotifyPerm(notifyState());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(ALERT_STORE_KEYS.settings, JSON.stringify(settings));
    } catch { /* 忽略配额失败 */ }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(ALERT_STORE_KEYS.acked, JSON.stringify(acked));
      localStorage.setItem(ALERT_STORE_KEYS.history, JSON.stringify(history.slice(-ALERT_HISTORY_LIMIT)));
      // 隔离：测试预览（preview）不持久化，禁污染真实 active 快照。
      localStorage.setItem(`${ALERT_STORE_KEYS.history}.active`, JSON.stringify(active.filter((a) => !a.preview)));
      localStorage.setItem(SEEN_KEYS_STORE_KEY, JSON.stringify(seenKeys.slice(-SEEN_KEYS_LIMIT)));
    } catch { /* 忽略 */ }
  }, [acked, history, active, seenKeys]);

  // Tab 闪（title 闪烁，有 ACTIVE 且开启 tabflash 才闪）。
  useEffect(() => {
    const base = 'PEPE·DOGE·ETHFI 突破雷达';
    if (!settingsRef.current.channels.tabflash || !active.some((a) => a.lifecycle === 'ACTIVE')) {
      document.title = base;
      return;
    }
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? `【提醒 ${active.length}】${base}` : base;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = base;
    };
  }, [active]);

  // 倒计时 tick（AUTO_DISMISS 超时停声关层但留历史）。
  useEffect(() => {
    if (!active.some((a) => a.lifecycle === 'ACTIVE')) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  void tick;

  const fireSystem = useCallback((rec: AlertRecord) => {
    if (!settingsRef.current.channels.system) return;
    if (notifyState() !== 'granted') return;
    try {
      const n = new Notification(rec.title, { body: rec.body, tag: rec.alertKey });
      n.onclick = () => {
        window.focus();
        document.getElementById('radar-live')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        n.close();
      };
    } catch { /* 忽略 */ }
  }, []);

  const ackedRef = useRef<string[]>([]);
  ackedRef.current = acked;
  const seenKeysRef = useRef<string[]>([]);
  seenKeysRef.current = seenKeys;
  const historyRef = useRef<AlertRecord[]>([]);
  historyRef.current = history;
  const activeRef = useRef<ActiveAlert[]>([]);
  activeRef.current = active;

  // C3：排队鸣响注册表（alertKey → timeout/interval 句柄），Esc/ACK/超时/停止键可取消。
  const soundTimers = useRef(new Map<string, { timeouts: ReturnType<typeof setTimeout>[]; interval: ReturnType<typeof setInterval> | null }>());

  const cancelAlertSound = useCallback((key: string) => {
    const entry = soundTimers.current.get(key);
    if (!entry) return;
    for (const t of entry.timeouts) clearTimeout(t);
    if (entry.interval) clearInterval(entry.interval);
    soundTimers.current.delete(key);
  }, []);

  const cancelAllAlertSounds = useCallback(() => {
    for (const [, entry] of soundTimers.current) {
      for (const t of entry.timeouts) clearTimeout(t);
      if (entry.interval) clearInterval(entry.interval);
    }
    soundTimers.current.clear();
    stopAlertSound();
  }, []);

  const scheduleAlertSound = useCallback((key: string, pattern: SoundPattern, soundId: string) => {
    cancelAlertSound(key);
    const entry = { timeouts: [] as ReturnType<typeof setTimeout>[], interval: null as ReturnType<typeof setInterval> | null };
    soundTimers.current.set(key, entry);
    const play = () => {
      const cur = settingsRef.current;
      if (cur.muted) return;
      playAlertSound(soundId, cur.volume, cur.muted);
    };
    if (pattern === 'CONTINUOUS_UNTIL_ACK') {
      // 首响即播，之后按间隔真持续，直到 ACK/超时/Esc 取消。
      entry.timeouts.push(setTimeout(play, 0));
      entry.interval = setInterval(() => {
        const paused = activeRef.current.find((a) => a.alertKey === key)?.soundPaused;
        if (paused) return; // Esc 暂停后不再续响，但排队仍保留直到取消
        play();
      }, CONTINUOUS_SOUND_INTERVAL_MS);
    } else {
      // 有限 Pattern：AUTO 下循环不超关闭时间由 timeout 截断。
      const delays = planPattern(pattern);
      for (const d of delays) entry.timeouts.push(setTimeout(play, d));
    }
  }, [cancelAlertSound]);

  const createAlert = useCallback((coin: AlertCoin, action: ActionCode, episodeId: string | null, price: number | null, freshLabel: string, darkReason: string | null, levels?: { breakoutLevel: number | null; invalidationLevel: number | null }) => {
    const s = settingsRef.current;
    if (!s.masterEnabled || !s.coins[coin]) return;
    const prev = prevRef.current[coin];
    const decision = shouldCreateAlert({
      coin,
      prevAction: prev,
      curAction: action,
      episodeId,
      price,
      freshnessLabel: freshLabel,
      subscriptions: s.subscriptions,
      existingKeys: [...seenKeysRef.current, ...ackedRef.current, ...historyRef.current.map((h) => h.alertKey), ...activeRef.current.map((a) => a.alertKey)],
      ackedKeys: ackedRef.current,
    });
    if (!decision.create) return;
    setSeenKeys((l) => (l.includes(decision.key) ? l : [...l, decision.key].slice(-SEEN_KEYS_LIMIT)));
    if (!isSubscribable(action)) return;
    const sub: SubscribableAction = action;
    const severity = ACTION_SEVERITY[sub];
    const title = `${coin} · ${ALERT_COPY[sub].title}`;
    const body = buildAlertBody(sub, price, freshLabel, levels);
    const rec: AlertRecord = {
      alertKey: decision.key,
      coin,
      episodeId,
      actionCode: action,
      severity,
      title,
      body,
      price,
      freshnessLabel: freshLabel,
      createdAt: Date.now(),
      lifecycle: 'TRIGGERED',
      darkReason,
    };
    let lifecycle: AlertLifecycle = nextAlertLifecycle('IDLE', { type: 'TRIGGER' });
    lifecycle = nextAlertLifecycle(lifecycle, { type: 'SHOW' });
    const withLife: ActiveAlert = { ...rec, lifecycle, shownAt: Date.now(), soundPaused: false };
    // 队列堆叠禁覆盖：append。
    setActive((l) => [...l, withLife]);
    setHistory((h) => pushHistory(h, { ...rec, lifecycle }));
    fireSystem(rec);
    // 声音按 Pattern 播放（C3：排队句柄可取消；CONTINUOUS 用 interval 真持续到 ACK/超时/Esc）。
    if (!s.muted) {
      scheduleAlertSound(decision.key, s.pattern, s.selectedSoundId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fireSystem, scheduleAlertSound]);

  // 轮询（只在页面存活时；关页停检见 CAPABILITY_NOTE）。
  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch('/api/market/overview');
        const o = (await res.json()) as OverviewPoll;
        if (stop) return;
        const s = settingsRef.current;
        if (!s.masterEnabled) {
          prevRef.current = { PEPE: snapshotCode(o, 'PEPE'), DOGE: snapshotCode(o, 'DOGE'), ETHFI: snapshotCode(o, 'ETHFI') };
          return;
        }
        const fresh = freshnessLabelOf(o);
        for (const coin of ['PEPE', 'DOGE', 'ETHFI'] as AlertCoin[]) {
          if (!s.coins[coin]) {
            prevRef.current[coin] = snapshotCode(o, coin);
            continue;
          }
          const sig = coin === 'PEPE' ? o.data.pepe : coin === 'DOGE' ? o.data.doge : (o.data.ethfi ?? null);
          const px = o.data.prices[coin];
          const feedStatus = o.freshness?.status ?? (o.status === 'live' ? 'ok' : 'unavailable');
          const input = actionInputFromSignal(sig, {
            asset: coin,
            price: px?.last ?? null,
            priceTs: px?.ts ?? null,
            forcedStatus: feedStatus,
            staleReason: o.freshness?.reason ?? null,
          });
          const st = deriveActionState(input);
          const darkReason = st.code === 'DATA_BLOCKED' ? (input.staleReason ?? o.error ?? '数据不足') : null;
          // C2：突破位/失效位取自现有 Episode 信号（sig.breakout.level / sig.keyLevels），无则 null（正文诚实写未知）。
          const breakoutLevel = sig?.breakout?.level ?? sig?.keyLevels?.breakoutLevel ?? null;
          const invalidationLevel = sig?.keyLevels?.invalidation ?? null;
          createAlert(coin, st.code, sig?.breakout?.episodeId ?? null, px?.last ?? null, fresh, darkReason, { breakoutLevel, invalidationLevel });
          prevRef.current[coin] = st.code;
        }
      } catch { /* 轮询失败不建 Alert（R1：无信号不报警） */ }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [createAlert]);

  function snapshotCode(o: OverviewPoll, coin: AlertCoin): ActionCode {
    try {
      const sig = coin === 'PEPE' ? o.data.pepe : coin === 'DOGE' ? o.data.doge : (o.data.ethfi ?? null);
      const px = o.data.prices[coin];
      const feedStatus = o.freshness?.status ?? (o.status === 'live' ? 'ok' : 'unavailable');
      const input = actionInputFromSignal(sig, { asset: coin, price: px?.last ?? null, priceTs: px?.ts ?? null, forcedStatus: feedStatus, staleReason: o.freshness?.reason ?? null });
      return deriveActionState(input).code;
    } catch {
      return 'DATA_BLOCKED';
    }
  }

  const ack = useCallback((key: string) => {
    // 隔离：测试预览 ACK 只关闭浮层，禁写 acked/历史（禁污染真实态）。
    const target = activeRef.current.find((a) => a.alertKey === key);
    if (target?.preview) {
      stopAlertSound();
      setActive((list) => list.filter((a) => a.alertKey !== key));
      return;
    }
    // C3：ACK 即停声并取消该报警的排队鸣响（CONTINUOUS 真停）。
    cancelAlertSound(key);
    stopAlertSound();
    setActive((list) => list.map((a) => (a.alertKey === key ? { ...a, lifecycle: nextAlertLifecycle(a.lifecycle, { type: 'ACK' }) } : a)).filter((a) => a.lifecycle === 'ACTIVE'));
    setAcked((l) => (l.includes(key) ? l : [...l, key]));
    setHistory((h) => h.map((r) => (r.alertKey === key ? { ...r, lifecycle: 'ACKNOWLEDGED' as AlertLifecycle } : r)));
  }, [cancelAlertSound]);

  // Esc 禁当 ACK：只暂停声音并取消已排队鸣响，保持 ACTIVE（C3：排队可取消）。
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        cancelAllAlertSounds();
        setActive((l) => l.map((a) => ({ ...a, soundPaused: true })));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelAllAlertSounds]);

  // AUTO 超时检查（每 tick）：超时停声关层但留历史，并取消该报警排队鸣响。
  useEffect(() => {
    const s = settingsRef.current;
    if (s.dismissMode !== 'AUTO_DISMISS') return;
    setActive((list) => {
      const now = Date.now();
      const expired = list.filter((a) => (now - a.shownAt) / 1000 >= s.autoDismissSecs && a.lifecycle === 'ACTIVE');
      if (!expired.length) return list;
      for (const e of expired) cancelAlertSound(e.alertKey);
      stopAlertSound();
      // 隔离：测试预览超时只关层，禁写真实历史。
      const realExpired = expired.filter((a) => !a.preview);
      if (realExpired.length) {
        setHistory((h) => h.map((r) => (realExpired.some((e) => e.alertKey === r.alertKey) ? { ...r, lifecycle: 'AUTO_DISMISSED' as AlertLifecycle } : r)));
      }
      return list.filter((a) => !expired.some((e) => e.alertKey === a.alertKey));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, cancelAlertSound]);

  // 卸载时清理全部排队鸣响（禁残留）。
  useEffect(() => () => {
    for (const [, entry] of soundTimers.current) {
      for (const t of entry.timeouts) clearTimeout(t);
      if (entry.interval) clearInterval(entry.interval);
    }
    soundTimers.current.clear();
    stopAlertSound();
  }, []);

  const enableSound = useCallback(async () => {
    const r = await ensureAudioUnlocked(settingsRef.current.selectedSoundId);
    setAudioLocked(!r.ok);
  }, []);

  const requestNotify = useCallback(() => {
    if (!('Notification' in window)) {
      setNotifyPerm('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setNotifyPerm('denied');
      return; // DENIED 禁反复请求
    }
    if (Notification.permission === 'granted') {
      setNotifyPerm('granted');
      return;
    }
    Notification.requestPermission().then((p) => setNotifyPerm(p as NotifyState));
  }, []);

  // 测试报警隔离路径（QA）：只进 active 浮层预览（标 TEST/preview），禁写真实
  // Alert History、禁碰 seenKeys/acked、禁改 prevRef（Market State）。
  const sendTest = useCallback(() => {
    const s = settingsRef.current;
    const key = `PEPE|${TEST_ALERT_EPISODE_ID}|BREAKOUT_TRACK`;
    const rec: AlertRecord = {
      alertKey: `${key}|${Date.now()}`,
      coin: 'PEPE',
      episodeId: TEST_ALERT_EPISODE_ID,
      actionCode: 'BREAKOUT_TRACK',
      severity: 'IMPORTANT',
      title: 'PEPE · 测试报警（不代表真实信号）',
      body: buildAlertBody('BREAKOUT_TRACK', null, '测试'),
      price: null,
      freshnessLabel: '测试',
      createdAt: Date.now(),
      lifecycle: 'ACTIVE',
      darkReason: null,
    };
    setActive((l) => [...l, { ...rec, shownAt: Date.now(), soundPaused: false, preview: true }]);
    if (!s.muted) playAlertSound(s.selectedSoundId, s.volume, s.muted);
    fireSystem(rec);
  }, [fireSystem]);

  // 停止当前所有声音（试听 + 真实报警声共用），取消全部排队鸣响并暂停各浮层声音标记。
  const stopAllSounds = useCallback(() => {
    cancelAllAlertSounds();
    setActive((l) => l.map((x) => ({ ...x, soundPaused: true })));
  }, [cancelAllAlertSounds]);

  const autoSecs = settings.dismissMode === 'AUTO_DISMISS' ? settings.autoDismissSecs : null;
  // HIGH-1：多 ACTIVE 队列视图（禁覆盖、禁只放首个）：Modal 按队列逐个处理，
  // 横幅堆叠上限外聚合。声音调度不动（严格串行化另起，不碰）。
  const actives = active.filter((a) => a.lifecycle === 'ACTIVE');
  const bannerList = actives.filter(() => settings.channels.banner);
  const BANNER_CAP = 2;
  const shownBanners = bannersExpanded ? bannerList : bannerList.slice(0, BANNER_CAP);
  const hiddenBannerCount = bannerList.length - shownBanners.length;
  const modalList = settings.channels.modal ? actives : [];
  const modalCur = modalList.length ? modalList[Math.min(modalIdx, modalList.length - 1)] : null;
  const modalPos = modalList.length ? Math.min(modalIdx, modalList.length - 1) : 0;

  return (
    <div aria-label="报警中心">
      {/* 横幅队列（堆叠上限 2，超出聚合，禁覆盖） */}
      <div className="fixed right-4 top-16 z-50 flex w-[min(92vw,380px)] flex-col gap-2">
        {shownBanners.map((a) => {
          const left = autoSecs != null ? countdownLeft(autoSecs, (Date.now() - a.shownAt) / 1000) : null;
          const sev = ALERT_SEVERITY_STYLES[a.severity];
          return (
            <div key={a.alertKey} className={`min-w-0 rounded-lg border border-l-4 ${sev.bar} px-4 py-3 shadow-lg backdrop-blur ${a.preview ? 'border-dashed' : ''} border-border bg-background/95 ${settings.channels.cardpulse ? 'alert-card-pulse' : ''}`}>
              <div className="flex min-w-0 items-center gap-2">
                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${sev.badge}`}>{a.severity}</span>
                <div className={`min-w-0 flex-1 break-words text-sm font-semibold ${sev.title}`}>{a.title}</div>
              </div>
              {a.preview && <div className="mt-1 inline-block rounded border border-dashed border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">TEST·隔离预览（不入历史、不影响真实状态）</div>}
              <p className="mt-1 min-w-0 break-words text-xs leading-relaxed text-muted-foreground">{a.body}</p>
              {a.darkReason && <p className="mt-1 min-w-0 break-words text-[11px] text-muted-foreground">原因：{a.darkReason}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => ack(a.alertKey)} className="rounded-md bg-radar px-3 py-1 text-xs font-medium text-primary-foreground">知道了（ACK）</button>
                {left != null && <span className="text-[11px] text-muted-foreground">{left}s 后自动关闭</span>}
                <button type="button" onClick={() => { cancelAlertSound(a.alertKey); stopAlertSound(); setActive((l) => l.map((x) => (x.alertKey === a.alertKey ? { ...x, soundPaused: true } : x))); }} className="rounded-md border border-border px-2 py-1 text-[11px]" title="按 Esc 同效">暂停声音（Esc 同效，保持提醒）</button>
                <button type="button" onClick={stopAllSounds} className="rounded-md border border-border px-2 py-1 text-[11px]">停止当前声音</button>
                <span className="text-xs text-muted-foreground">Esc 只暂停声音，不确认</span>
              </div>
              {audioLocked && <button type="button" onClick={enableSound} className="mt-2 text-[11px] text-warn underline">声音被浏览器拦截，点击恢复</button>}
            </div>
          );
        })}
        {hiddenBannerCount > 0 && (
          <button type="button" onClick={() => setBannersExpanded(true)} className="rounded-lg border border-border bg-background/95 px-4 py-2 text-xs text-muted-foreground shadow-lg">
            还有 {hiddenBannerCount} 条报警，点击展开
          </button>
        )}
        {bannersExpanded && bannerList.length > BANNER_CAP && (
          <button type="button" onClick={() => setBannersExpanded(false)} className="rounded-lg border border-border bg-background/95 px-4 py-2 text-xs text-muted-foreground shadow-lg">
            收起横幅
          </button>
        )}
      </div>

      {/* Modal（队列逐个处理：1/N + 切币种 tab + 倒计时，HIGH-1/HIGH-4） */}
      {modalCur && (
        <div role="alertdialog" aria-label="报警弹窗" className="fixed inset-0 z-40 flex items-center justify-center bg-background/60 p-4">
          <div className={`w-[min(92vw,440px)] rounded-xl border border-l-4 ${ALERT_SEVERITY_STYLES[modalCur.severity].bar} border-border bg-background p-5 shadow-xl`}>
            <div className="flex min-w-0 items-center justify-between gap-2">
              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${ALERT_SEVERITY_STYLES[modalCur.severity].badge}`}>{modalCur.severity}</span>
              <span className="shrink-0 text-[11px] text-muted-foreground">{modalList.length > 1 ? `${modalPos + 1}/${modalList.length}` : autoSecs != null ? `${countdownLeft(autoSecs, (Date.now() - modalCur.shownAt) / 1000)}s 后自动关闭` : ''}</span>
            </div>
            {modalList.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1" role="tablist" aria-label="报警队列">
                {modalList.map((m, i) => (
                  <button key={m.alertKey} type="button" role="tab" aria-selected={i === modalPos} onClick={() => setModalIdx(i)} className={`rounded-md border px-2 py-1 text-[11px] ${i === modalPos ? 'border-radar/50 bg-radar/10 text-radar' : 'border-border text-muted-foreground'}`}>
                    {m.coin} · {i + 1}
                  </button>
                ))}
              </div>
            )}
            <div className={`mt-2 min-w-0 break-words text-base font-semibold ${ALERT_SEVERITY_STYLES[modalCur.severity].title}`}>{modalCur.title}</div>
            <p className="mt-2 min-w-0 break-words text-sm leading-relaxed text-muted-foreground">{modalCur.body}</p>
            <p className="mt-2 text-[11px] text-muted-foreground">刷新后提醒恢复显示（声音需点击恢复）。{CAPABILITY_NOTE}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { ack(modalCur.alertKey); setModalIdx(0); }} className="rounded-md bg-radar px-4 py-2 text-sm font-medium text-primary-foreground">知道了（ACK）</button>
              <button type="button" onClick={stopAllSounds} className="rounded-md border border-border px-4 py-2 text-sm">暂停声音</button>
              {modalList.length > 1 && (
                <>
                  <button type="button" onClick={() => setModalIdx((modalPos + modalList.length - 1) % modalList.length)} className="rounded-md border border-border px-3 py-2 text-xs">上一个</button>
                  <button type="button" onClick={() => setModalIdx((modalPos + 1) % modalList.length)} className="rounded-md border border-border px-3 py-2 text-xs">下一个</button>
                </>
              )}
              <span className="text-xs text-muted-foreground">按 Esc 只暂停声音，不会确认报警</span>
            </div>
          </div>
        </div>
      )}

      {/* 常驻入口（MED-8：移左下避横幅碰撞；铃铛数只计 ACTIVE，禁误读历史数） */}
      <div className="fixed bottom-4 left-4 z-50 flex gap-2">
        <button type="button" onClick={() => setHistoryOpen((v) => !v)} className="rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs shadow">历史（{history.length}）</button>
        <button type="button" onClick={() => setSettingsOpen((v) => !v)} className="rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs shadow">🔔 报警设置{actives.length ? `（${actives.length}）` : ''}</button>
      </div>

      {historyOpen && (
        <div className="fixed bottom-16 left-4 z-50 max-h-[50vh] w-[min(92vw,420px)] overflow-auto rounded-lg border border-border bg-background p-4 shadow-xl">
          <div className="mb-2 text-sm font-semibold">报警历史（最多 {ALERT_HISTORY_LIMIT} 条）</div>
          {history.length === 0 && <p className="text-xs text-muted-foreground">暂无历史。</p>}
          {[...history].reverse().map((h) => (
            <div key={`${h.alertKey}|${h.createdAt}`} className="border-b border-border/60 py-2 text-xs">
              <div className="min-w-0 break-words font-medium">{h.title}</div>
              <div className="min-w-0 break-words text-muted-foreground">{formatTs(h.createdAt)} · {h.severity} · {h.lifecycle}{h.darkReason ? ` · 原因：${h.darkReason}` : ''}</div>
            </div>
          ))}
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          audioLocked={audioLocked}
          onEnableSound={enableSound}
          notifyPerm={notifyPerm}
          onRequestNotify={requestNotify}
          onSendTest={sendTest}
          onStopAllSounds={stopAllSounds}
        />
      )}
    </div>
  );
}

function SettingsPanel(props: {
  settings: AlertSettings;
  onChange: (s: AlertSettings) => void;
  audioLocked: boolean;
  onEnableSound: () => void;
  notifyPerm: NotifyState;
  onRequestNotify: () => void;
  onSendTest: () => void;
  onStopAllSounds: () => void;
}) {
  const { settings: s, onChange } = props;
  const set = (p: Partial<AlertSettings>) => onChange(sanitizeSettings({ ...s, ...p }));
  // MED-7：试听即保存——选中声音立即生效并试听，无两段式“试听/保存”心智负担。
  // 试听定时器：停止试听/切换声音/卸载时清理，禁旧声残留。
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    stopAlertSound();
  }, []);
  const stopPreview = useCallback(() => {
    if (previewTimer.current) {
      clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    stopAlertSound();
  }, []);
  const pickSound = useCallback((id: string) => {
    // 切换声音先停旧声，再保存并试听新声。
    stopPreview();
    props.onEnableSound();
    set({ selectedSoundId: id });
    previewTimer.current = setTimeout(() => playAlertSound(id, s.volume, s.muted), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopPreview, s.volume, s.muted]);

  return (
    <div className="fixed bottom-16 left-4 z-50 max-h-[70vh] w-[min(94vw,440px)] overflow-auto rounded-lg border border-border bg-background p-4 shadow-xl" aria-label="报警设置中心">
      <div className="text-sm font-semibold">报警设置中心</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{CAPABILITY_NOTE}</p>

      <details open className="mt-3">
        <summary className="cursor-pointer text-xs font-medium">提醒开关</summary>
        <label className="mt-2 flex items-center justify-between text-xs">
          <span>总开关</span>
          <input type="checkbox" checked={s.masterEnabled} onChange={(e) => set({ masterEnabled: e.target.checked })} />
        </label>
        <div className="mt-2 text-xs text-muted-foreground">分币种</div>
        {(['PEPE', 'DOGE', 'ETHFI'] as AlertCoin[]).map((c) => (
          <label key={c} className="flex items-center justify-between text-xs">
            <span>{c}</span>
            <input type="checkbox" checked={s.coins[c]} onChange={(e) => set({ coins: { ...s.coins, [c]: e.target.checked } })} />
          </label>
        ))}
        <div className="mt-2 text-xs text-muted-foreground">状态订阅（默认跟踪/回踩/淘汰/数据不足开，观察关，过热可选）</div>
        {(Object.keys(s.subscriptions) as SubscribableAction[]).map((k) => (
          <label key={k} className="flex items-center justify-between text-xs">
            <span>{SUBSCRIPTION_LABELS[k]}</span>
            <input type="checkbox" checked={s.subscriptions[k]} onChange={(e) => set({ subscriptions: { ...s.subscriptions, [k]: e.target.checked } })} />
          </label>
        ))}
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">持续方式</summary>
        <label className="mt-2 flex items-center gap-2 text-xs">
          <select value={s.dismissMode} onChange={(e) => set({ dismissMode: e.target.value as DismissMode })} className="rounded border border-border bg-background px-2 py-1">
            <option value="UNTIL_ACK">{DISMISS_MODE_LABELS.UNTIL_ACK}</option>
            <option value="AUTO_DISMISS">{DISMISS_MODE_LABELS.AUTO_DISMISS}</option>
          </select>
        </label>
        {s.dismissMode === 'AUTO_DISMISS' && (
          <label className="mt-1 flex items-center gap-2 text-xs">
            <span>持续秒数</span>
            <select value={s.autoDismissSecs} onChange={(e) => set({ autoDismissSecs: Number(e.target.value) as AutoDismissSecs })} className="rounded border border-border bg-background px-2 py-1">
              {AUTO_DISMISS_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}s</option>
              ))}
            </select>
          </label>
        )}
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">声音</summary>
        <div className="mt-2 text-[11px] text-muted-foreground">当前：{ALERT_SOUNDS.find((d) => d.id === s.selectedSoundId)?.label ?? s.selectedSoundId} · 选中即保存并试听</div>
        <label className="mt-1 flex items-center gap-2 text-xs">
          <select value={s.selectedSoundId} onChange={(e) => pickSound(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
            {ALERT_SOUNDS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
          <button type="button" onClick={() => pickSound(s.selectedSoundId)} className="rounded border border-border px-2 py-1">试听</button>
          <button type="button" onClick={stopPreview} className="rounded border border-border px-2 py-1">停止试听</button>
        </label>
        <button type="button" onClick={props.onStopAllSounds} className="mt-1 rounded border border-border px-2 py-1 text-xs">停止当前声音</button>
        {props.audioLocked && <button type="button" onClick={props.onEnableSound} className="mt-1 text-[11px] text-warn underline">启用声音需点击初始化（浏览器自动播放限制），点击后播放测试音</button>}

        <div className="mt-2 text-xs text-muted-foreground">重复方式</div>
        <label className="flex items-center gap-2 text-xs">
          <select value={s.pattern} onChange={(e) => set({ pattern: e.target.value as SoundPattern })} className="rounded border border-border bg-background px-2 py-1">
            {SOUND_PATTERNS.map((p) => (
              <option key={p} value={p}>{SOUND_PATTERN_LABELS[p]}</option>
            ))}
          </select>
        </label>

        <label className="mt-2 flex items-center justify-between text-xs">
          <span>音量（0-100，默认 40 不大） · 当前 {s.volume}</span>
          <span className="flex items-center gap-2">
            <input type="range" min={0} max={100} value={s.volume} onChange={(e) => set({ volume: Number(e.target.value) })} aria-label="音量 0 到 100" />
            <output aria-label="当前音量数值">{s.volume}</output>
          </span>
        </label>
        <label className="flex items-center justify-between text-xs">
          <span>静音</span>
          <input type="checkbox" checked={s.muted} onChange={(e) => set({ muted: e.target.checked })} />
        </label>
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">提醒方式</summary>
        <div className="mt-2">
          {DISPLAY_CHANNELS.map((c: DisplayChannel) => (
            <label key={c} className="flex items-center justify-between text-xs">
              <span>{DISPLAY_CHANNEL_LABELS[c]}</span>
              <input type="checkbox" checked={s.channels[c]} onChange={(e) => set({ channels: { ...s.channels, [c]: e.target.checked } })} />
            </label>
          ))}
        </div>
        <div className="mt-2 text-xs">
          <div>系统通知权限：{props.notifyPerm}（如被拒绝请到浏览器地址栏通知设置中手动允许，本页不再反复弹窗）</div>
          <button type="button" onClick={props.onRequestNotify} className="mt-1 rounded border border-border px-2 py-1">请求通知权限</button>
        </div>
      </details>

      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium">测试</summary>
        <button type="button" onClick={props.onSendTest} className="mt-2 rounded-md bg-radar px-3 py-1.5 text-xs font-medium text-primary-foreground">发送测试报警</button>
        <p className="mt-1 text-[11px] text-muted-foreground">测试报警为 TEST 隔离预览，不写入报警历史、不影响真实提醒状态。</p>
      </details>
    </div>
  );
}
