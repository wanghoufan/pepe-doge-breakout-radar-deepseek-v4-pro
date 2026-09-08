/**
 * Phase B：Alert Center 报警中心（B-TEST1 ~ B-TEST25）。
 * 纯函数层，不依赖 DOM/Audio/Notification/网络；不改任何量化策略、阈值与权重。
 * 禁未来数据：实时链路禁 MFE/MAE/Outcome/Test（B-TEST21/22 覆盖）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ACTION_SEVERITY,
  ALERT_COPY,
  ALERT_HISTORY_LIMIT,
  ALERT_STORE_KEYS,
  AUTO_DISMISS_OPTIONS,
  BANNED_COPY_WORDS,
  CAPABILITY_NOTE,
  DEFAULT_ALERT_SETTINGS,
  DEFAULT_SUBSCRIPTIONS,
  DISPLAY_CHANNELS,
  SOUND_PATTERNS,
  TEST_ALERT_EPISODE_ID,
  buildAlertBody,
  buildAlertKey,
  countdownLeft,
  isSubscribable,
  isTestAlertKey,
  isTestAlertRecord,
  maxSoundLoops,
  nextAlertLifecycle,
  planPattern,
  pushHistory,
  sanitizeSettings,
  shouldCreateAlert,
  type AlertRecord,
} from './alert-center';
import { ALERT_SOUNDS, getSoundDef } from './alert-sound';

const here = path.dirname(fileURLToPath(import.meta.url));
const readSrc = (f: string) => fs.readFileSync(path.join(here, f), 'utf8');
/** 去注释后检查（注释中的禁项声明不算触碰，只查可执行代码）。 */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* B-TEST1：默认订阅（跟踪/回踩/淘汰/数据不足开，观察关，过热可选关）。 */
test('B-TEST1：默认订阅开/关符合任务书', () => {
  assert.equal(DEFAULT_SUBSCRIPTIONS.BREAKOUT_TRACK, true);
  assert.equal(DEFAULT_SUBSCRIPTIONS.RETEST_WATCH, true);
  assert.equal(DEFAULT_SUBSCRIPTIONS.REJECT, true);
  assert.equal(DEFAULT_SUBSCRIPTIONS.DATA_BLOCKED, true);
  assert.equal(DEFAULT_SUBSCRIPTIONS.WATCH, false);
  assert.equal(DEFAULT_SUBSCRIPTIONS.OVERHEATED, false);
});

/* B-TEST2：只监听现有信号，不创造新信号（NO_ACTION 永不报警）。 */
test('B-TEST2：NO_ACTION 不可订阅、不建 Alert', () => {
  assert.equal(isSubscribable('NO_ACTION'), false);
  const r = shouldCreateAlert({
    coin: 'PEPE', prevAction: 'WATCH', curAction: 'NO_ACTION', episodeId: null,
    price: null, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [], ackedKeys: [],
  });
  assert.equal(r.create, false);
  assert.equal(r.reason, 'not-subscribable');
});

/* B-TEST3：状态变化才建 Alert（prev!=cur 且订阅内）。 */
test('B-TEST3：无变化不建，有变化且订阅才建', () => {
  const base = { coin: 'PEPE' as const, episodeId: 'ep1', price: 1, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS, WATCH: true }, existingKeys: [] as string[], ackedKeys: [] as string[] };
  assert.equal(shouldCreateAlert({ ...base, prevAction: 'WATCH', curAction: 'WATCH' }).reason, 'no-state-change');
  assert.equal(shouldCreateAlert({ ...base, prevAction: 'WATCH', curAction: 'BREAKOUT_TRACK' }).create, true);
  const unsub = shouldCreateAlert({ ...base, prevAction: null, curAction: 'WATCH', subscriptions: { ...DEFAULT_SUBSCRIPTIONS } });
  assert.equal(unsub.create, false);
  assert.equal(unsub.reason, 'unsubscribed');
});

/* B-TEST4：alertKey = symbol+episodeId+actionState。 */
test('B-TEST4：alertKey 格式', () => {
  assert.equal(buildAlertKey('PEPE', 'ep7', 'REJECT'), 'PEPE|ep7|REJECT');
  assert.equal(buildAlertKey('DOGE', null, 'WATCH'), 'DOGE|no-episode|WATCH');
});

/* B-TEST5：同键只建一个（刷新/轮询/重挂载禁重复）。 */
test('B-TEST5：existingKeys 命中禁重复', () => {
  const key = buildAlertKey('PEPE', 'ep1', 'BREAKOUT_TRACK');
  const r = shouldCreateAlert({
    coin: 'PEPE', prevAction: null, curAction: 'BREAKOUT_TRACK', episodeId: 'ep1',
    price: 1, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [key], ackedKeys: [],
  });
  assert.equal(r.create, false);
  assert.equal(r.reason, 'duplicate-key');
});

/* B-TEST6：ACK 后同 episode+state 禁再报，新 Episode（不同 key）允许。 */
test('B-TEST6：ACK 语义', () => {
  const key = buildAlertKey('PEPE', 'ep1', 'REJECT');
  const blocked = shouldCreateAlert({
    coin: 'PEPE', prevAction: null, curAction: 'REJECT', episodeId: 'ep1',
    price: 1, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [], ackedKeys: [key],
  });
  assert.equal(blocked.create, false);
  assert.equal(blocked.reason, 'acked');
  const fresh = shouldCreateAlert({
    coin: 'PEPE', prevAction: 'REJECT', curAction: 'REJECT', episodeId: 'ep2',
    price: 1, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [], ackedKeys: [key],
  });
  // prev==cur 仍禁（R2），即使新 episode 也需"离后重入"的变化事件；此处断言 key 不同即视为不同报警键
  assert.notEqual(buildAlertKey('PEPE', 'ep2', 'REJECT'), key);
  assert.equal(fresh.create, false); // 无状态变化仍禁
});

/* B-TEST7：UNTIL_ACK（ACK 才确认；无 ESC 事件，ACTIVE 不会被 Esc/挂载改变）。 */
test('B-TEST7：UNTIL_ACK 状态机 + Esc 禁当 ACK', () => {
  let s = nextAlertLifecycle('IDLE', { type: 'TRIGGER' });
  assert.equal(s, 'TRIGGERED');
  s = nextAlertLifecycle(s, { type: 'SHOW' });
  assert.equal(s, 'ACTIVE');
  // 无 ESC 事件类型：任何非 ACK 事件都不离开 ACTIVE（RESET 除外不在 ACTIVE 处理）
  assert.equal(nextAlertLifecycle('ACTIVE', { type: 'RESET' }), 'ACTIVE');
  s = nextAlertLifecycle(s, { type: 'ACK' });
  assert.equal(s, 'ACKNOWLEDGED');
});

/* B-TEST8：AUTO_DISMISS（10/30/60 必备 + 倒计时 + 超时转移）。 */
test('B-TEST8：AUTO 选项/倒计时/超时', () => {
  assert.deepEqual(AUTO_DISMISS_OPTIONS, [10, 30, 60]);
  assert.equal(countdownLeft(30, 12.2), 18);
  assert.equal(countdownLeft(10, 99), 0);
  assert.equal(nextAlertLifecycle('ACTIVE', { type: 'AUTO_DISMISS_TIMEOUT' }), 'AUTO_DISMISSED');
});

/* B-TEST9：10 种可区分声音。 */
test('B-TEST9：10 种声音 id/标签/步骤唯一可区分', () => {
  assert.equal(ALERT_SOUNDS.length, 10);
  const ids = new Set(ALERT_SOUNDS.map((s) => s.id));
  assert.equal(ids.size, 10);
  assert.ok(ALERT_SOUNDS.every((s) => s.steps.length >= 1 && s.loopSecs > 0));
  const sigs = new Set(ALERT_SOUNDS.map((s) => JSON.stringify(s.steps)));
  assert.equal(sigs.size, 10);
  assert.equal(getSoundDef('nope').id, ALERT_SOUNDS[0].id);
});

/* B-TEST10：音量 sanitize（0-100 钳制 + 默认不大）与默认声音存在。 */
test('B-TEST10：音量钳制 + 默认不大 + 默认声音可解析', () => {
  assert.ok(DEFAULT_ALERT_SETTINGS.volume <= 50);
  assert.equal(sanitizeSettings({ volume: 999 }).volume, 100);
  assert.equal(sanitizeSettings({ volume: -5 }).volume, 0);
  assert.ok(getSoundDef(DEFAULT_ALERT_SETTINGS.selectedSoundId).steps.length >= 1);
});

/* B-TEST11：5 种 Pattern 齐备且计划非空。 */
test('B-TEST11：5 种 Pattern', () => {
  assert.deepEqual(SOUND_PATTERNS, ['ONCE', 'DOUBLE', 'TRIPLE', 'INTERVAL', 'CONTINUOUS_UNTIL_ACK']);
  assert.deepEqual(planPattern('ONCE'), [0]);
  assert.equal(planPattern('DOUBLE').length, 2);
  assert.equal(planPattern('TRIPLE').length, 3);
  assert.ok(planPattern('INTERVAL').length >= 2);
  assert.ok(planPattern('CONTINUOUS_UNTIL_ACK').length >= 2);
});

/* B-TEST12：AUTO 下循环不超关闭时间。 */
test('B-TEST12：maxSoundLoops 上限', () => {
  assert.equal(maxSoundLoops(30, 0.6), 50);
  assert.equal(maxSoundLoops(10, 0), 1);
  assert.ok(maxSoundLoops(60, 0.5) * 0.5 <= 60 + 0.5);
});

/* B-TEST13：5 表现通道多选。 */
test('B-TEST13：5 表现通道', () => {
  assert.deepEqual(DISPLAY_CHANNELS, ['modal', 'banner', 'system', 'tabflash', 'cardpulse']);
  const ch = DEFAULT_ALERT_SETTINGS.channels;
  assert.equal(Object.keys(ch).length, 5);
});

/* B-TEST14：设置 sanitize（非法 AUTO 秒数回退，订阅合并）+ 测试态与真实态隔离。 */
test('B-TEST14：sanitizeSettings + 测试报警隔离（禁写真实历史）', () => {
  const s = sanitizeSettings({ autoDismissSecs: 99 as never, subscriptions: { WATCH: true } });
  assert.equal(s.autoDismissSecs, 30);
  assert.equal(s.subscriptions.WATCH, true);
  assert.equal(s.subscriptions.BREAKOUT_TRACK, true);
  // 补强（QA FAIL：TEST ALERT 污染历史面板）：测试记录可识别，且 pushHistory 拒收。
  const testRec: AlertRecord = {
    alertKey: `PEPE|${TEST_ALERT_EPISODE_ID}|BREAKOUT_TRACK`, coin: 'PEPE', episodeId: TEST_ALERT_EPISODE_ID,
    actionCode: 'BREAKOUT_TRACK', severity: 'IMPORTANT', title: 'PEPE · 测试报警（不代表真实信号）',
    body: 'b', price: null, freshnessLabel: '测试', createdAt: 1, lifecycle: 'ACTIVE', darkReason: null,
  };
  const realRec: AlertRecord = {
    ...testRec, alertKey: 'PEPE|ep1|BREAKOUT_TRACK', episodeId: 'ep1',
    title: 'PEPE · 突破跟踪：已收盘确认，开始观察后续',
  };
  assert.equal(isTestAlertKey(testRec.alertKey), true);
  assert.equal(isTestAlertKey(realRec.alertKey), false);
  assert.equal(isTestAlertRecord(testRec), true);
  assert.equal(isTestAlertRecord(realRec), false);
  assert.equal(pushHistory([], testRec).length, 0); // 测试禁写真实历史
  assert.equal(pushHistory([], realRec).length, 1); // 真实照常写入
  assert.equal(pushHistory([realRec], testRec).length, 1); // 测试不挤占真实历史
  // UI 层隔离：sendTest 走隔离路径（禁调 pushHistory/setHistory 写历史，禁碰 seenKeys/acked）。
  const hostSrc = fs.readFileSync(path.join(here, '../components/market/AlertCenter.tsx'), 'utf8');
  const sendStart = hostSrc.indexOf('const sendTest');
  assert.ok(sendStart >= 0, 'sendTest 存在');
  const sendBlock = hostSrc.slice(sendStart, hostSrc.indexOf('}, [fireSystem]);', sendStart));
  assert.ok(sendBlock.length > 0, 'sendTest 块可提取');
  assert.ok(!sendBlock.includes('pushHistory'), 'sendTest 禁写历史（pushHistory）');
  assert.ok(!sendBlock.includes('setHistory'), 'sendTest 禁写历史（setHistory）');
  assert.ok(!sendBlock.includes('setSeenKeys') && !sendBlock.includes('setAcked'), 'sendTest 禁改去重/确认态');
  assert.ok(!sendBlock.includes('prevRef'), 'sendTest 禁改 Market State（prevRef）');
  // 声音停止键在位（QA FAIL：只有试听无停止键）。
  assert.ok(hostSrc.includes('stopAlertSound'), '停止声音函数已接入');
  assert.ok(hostSrc.includes('停止试听'), '停止试听按钮在位');
  assert.ok(hostSrc.includes('停止当前声音'), '停止当前声音按钮在位');
});

/* B-TEST15：能力边界诚实写（关页停检 + 无 Web Push 明写）。 */
test('B-TEST15：CAPABILITY_NOTE 含关页停检与无 Web Push', () => {
  assert.ok(CAPABILITY_NOTE.includes('关闭') || CAPABILITY_NOTE.includes('关页') || CAPABILITY_NOTE.includes('页面关闭'));
  assert.ok(CAPABILITY_NOTE.includes('Web Push'));
  assert.ok(ALERT_STORE_KEYS.settings.length > 0 && ALERT_STORE_KEYS.acked.length > 0 && ALERT_STORE_KEYS.history.length > 0);
});

/* B-TEST16：文案说人话（各状态标题正文 + 价格位 + Freshness + 禁语）。 */
test('B-TEST16：文案禁买入/胜率/概率/必涨', () => {
  for (const [code, copy] of Object.entries(ALERT_COPY)) {
    assert.ok(copy.title.length >= 4, code);
    assert.ok(copy.body.length >= 10, code);
    for (const w of BANNED_COPY_WORDS) {
      assert.ok(!copy.title.includes(w), `${code} title 含禁语 ${w}`);
      assert.ok(!copy.body.includes(w), `${code} body 含禁语 ${w}`);
    }
    const built = buildAlertBody(code as keyof typeof ALERT_COPY, 0.123, '新鲜');
    assert.ok(built.includes('0.123'), code);
    assert.ok(built.includes('新鲜'), code);
    for (const w of BANNED_COPY_WORDS) assert.ok(!built.includes(w), `${code} built 含禁语 ${w}`);
  }
});

/* B-TEST17：严重级别 INFO/WATCH/IMPORTANT/CRITICAL 全覆盖。 */
test('B-TEST17：严重级别映射', () => {
  const vals = new Set(Object.values(ACTION_SEVERITY));
  for (const s of ['INFO', 'WATCH', 'IMPORTANT', 'CRITICAL'] as const) assert.ok(vals.has(s), s);
  assert.equal(ACTION_SEVERITY.REJECT, 'CRITICAL');
  assert.equal(ACTION_SEVERITY.DATA_BLOCKED, 'INFO');
});

/* B-TEST18：历史 50 条（11 字段 + DARK 原因）。 */
test('B-TEST18：历史上限 50 + 11 字段 + darkReason', () => {
  const mk = (i: number): AlertRecord => ({
    alertKey: `k${i}`, coin: 'PEPE', episodeId: 'ep1', actionCode: 'REJECT', severity: 'CRITICAL',
    title: 't', body: 'b', price: 1, freshnessLabel: '新鲜', createdAt: i, lifecycle: 'ACTIVE', darkReason: 'r',
  });
  let list: AlertRecord[] = [];
  for (let i = 0; i < 60; i++) list = pushHistory(list, mk(i));
  assert.equal(list.length, ALERT_HISTORY_LIMIT);
  assert.equal(list[0].createdAt, 10); // 保留最新 50
  const keys = Object.keys(list[0]);
  for (const f of ['alertKey', 'coin', 'episodeId', 'actionCode', 'severity', 'title', 'body', 'price', 'freshnessLabel', 'createdAt', 'lifecycle']) {
    assert.ok(keys.includes(f), f);
  }
  assert.ok(keys.includes('darkReason'));
});

/* B-TEST19：队列堆叠禁覆盖。 */
test('B-TEST19：pushHistory append 不覆盖', () => {
  const a: AlertRecord = { alertKey: 'a', coin: 'PEPE', episodeId: null, actionCode: 'WATCH', severity: 'WATCH', title: 't', body: 'b', price: null, freshnessLabel: 'f', createdAt: 1, lifecycle: 'ACTIVE', darkReason: null };
  const b: AlertRecord = { ...a, alertKey: 'b', createdAt: 2 };
  const list = pushHistory(pushHistory([], a), b);
  assert.equal(list.length, 2);
  assert.equal(list[0].alertKey, 'a');
  assert.equal(list[1].alertKey, 'b');
});

/* B-TEST20：状态机全路径 + 禁 mount 决定生命周期。 */
test('B-TEST20：状态机 IDLE/TRIGGERED/ACTIVE/ACK/AUTO/EXPIRE/RESET', () => {
  assert.equal(nextAlertLifecycle('IDLE', { type: 'SHOW' }), 'IDLE'); // mount/误事件不推进
  assert.equal(nextAlertLifecycle('IDLE', { type: 'ACK' }), 'IDLE');
  assert.equal(nextAlertLifecycle('TRIGGERED', { type: 'ACK' }), 'TRIGGERED');
  assert.equal(nextAlertLifecycle('ACTIVE', { type: 'EXPIRE' }), 'EXPIRED');
  assert.equal(nextAlertLifecycle('AUTO_DISMISSED', { type: 'ACK' }), 'ACKNOWLEDGED');
  assert.equal(nextAlertLifecycle('ACKNOWLEDGED', { type: 'EXPIRE' }), 'EXPIRED');
  assert.equal(nextAlertLifecycle('EXPIRED', { type: 'TRIGGER' }), 'EXPIRED');
  assert.equal(nextAlertLifecycle('EXPIRED', { type: 'RESET' }), 'IDLE');
});

/* B-TEST21：禁未来数据（AlertRecord/逻辑层无 MFE/MAE/Outcome 字段；源码无禁 import）。 */
test('B-TEST21：禁未来数据', () => {
  const src = stripComments(readSrc('alert-center.ts') + readSrc('alert-sound.ts'));
  for (const w of ['mfe-mae', 'MFE', 'MAE', 'outcome', 'Outcome', 'backtest', 'samples']) {
    assert.ok(!src.includes(w), `源码含禁词 ${w}`);
  }
  const rec: AlertRecord = { alertKey: 'k', coin: 'DOGE', episodeId: null, actionCode: 'WATCH', severity: 'WATCH', title: 't', body: 'b', price: null, freshnessLabel: 'f', createdAt: 0, lifecycle: 'IDLE', darkReason: null };
  assert.ok(!('mfe' in rec) && !('mae' in rec) && !('outcome' in rec));
});

/* B-TEST22：禁 15 条（策略/权重/阈值/HardVeto/Rolling42/Episode判定/Walkforward/M5/holdout/胜率包装等零触碰）。 */
test('B-TEST22：报警层不碰量化禁项', () => {
  const src = stripComments(readSrc('alert-center.ts') + readSrc('alert-sound.ts'));
  const banned = ['DEFAULT_V2_THRESHOLDS', 'DEFAULT_V2_WEIGHTS', 'detectBreakout', 'Rolling', 'walkForward', 'walkforward', 'holdout', 'M5', '胜率', 'thresholds.chase', 'HardVetoKind'];
  // HardVetoKind 作为类型名出现在注释"监听 HardVeto"属允许，此处只禁对否决逻辑的判定性引用：
  // 注：BANNED_COPY_WORDS 本身含"胜率"等字面（禁语表），此处只查量化逻辑引用，不查禁语表；
  // 文案禁语由 B-TEST16 覆盖。
  const srcNoBanList = src.replace(/BANNED_COPY_WORDS[\s\S]*?\];/, '');
  const hardBan = ['DEFAULT_V2_THRESHOLDS', 'DEFAULT_V2_WEIGHTS', 'detectBreakout', 'walkForward', 'holdout'];
  for (const w of hardBan) assert.ok(!srcNoBanList.includes(w), `源码含禁项 ${w}`);
  // 补强：其余禁项逐项断言（Rolling/M5/阈值引用/否决判定/walkforward 小写变体）。
  // episodeId 属报警键合法字段（buildAlertKey），不在此禁列；禁语表本身（BANNED_COPY_WORDS 定义行）
  // 已在 srcNoBanList 中剔除，故此处可直接断言文案禁语零残留。
  const extendedBan = ['Rolling', 'walkforward', 'M5', 'thresholds.chase', 'thresholds', 'HardVetoKind', 'HardVeto'];
  for (const w of extendedBan) assert.ok(!srcNoBanList.includes(w), `源码含禁项 ${w}`);
  for (const w of ['胜率', '概率', '买入']) assert.ok(!srcNoBanList.includes(w), `源码含禁语 ${w}`);
  assert.ok(banned.length >= 6);
});

/* B-TEST23：grace 沿用无新增参数（报警层不定义新的宽限/阈值常量）。 */
test('B-TEST23：grace 沿用，报警层无新增时间宽限参数', () => {
  const src = readSrc('alert-center.ts');
  assert.ok(!src.includes('GRACE_MS'), '报警层不得新增 grace 常量');
  assert.ok(!src.includes('STALE_AFTER_MS'), '报警层不得新增 stale 阈值');
});

/* B-TEST24：DARK 原因（DATA_BLOCKED 携带，普通状态可为 null，历史保留）。 */
test('B-TEST24：darkReason 语义', () => {
  const dark: AlertRecord = { alertKey: 'd', coin: 'PEPE', episodeId: null, actionCode: 'DATA_BLOCKED', severity: 'INFO', title: 't', body: 'b', price: null, freshnessLabel: 'stale', createdAt: 1, lifecycle: 'ACTIVE', darkReason: 'confirmed_candle_missing' };
  const normal: AlertRecord = { ...dark, alertKey: 'n', actionCode: 'WATCH', darkReason: null };
  const list = pushHistory(pushHistory([], dark), normal);
  assert.equal(list[0].darkReason, 'confirmed_candle_missing');
  assert.equal(list[1].darkReason, null);
});

/* B-TEST25：AUTO 同状态禁重报（超时进历史后，同 key 仍禁建）。 */
test('B-TEST25：AUTO_DISMISSED 后同状态禁重报', () => {
  const key = buildAlertKey('DOGE', 'ep9', 'BREAKOUT_TRACK');
  const r = shouldCreateAlert({
    coin: 'DOGE', prevAction: null, curAction: 'BREAKOUT_TRACK', episodeId: 'ep9',
    price: 1, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [key], ackedKeys: [],
  });
  assert.equal(r.create, false);
  const afterAck = shouldCreateAlert({
    coin: 'DOGE', prevAction: null, curAction: 'BREAKOUT_TRACK', episodeId: 'ep9',
    price: 1, freshnessLabel: '新鲜', subscriptions: { ...DEFAULT_SUBSCRIPTIONS },
    existingKeys: [], ackedKeys: [key],
  });
  assert.equal(afterAck.create, false);
  assert.equal(afterAck.reason, 'acked');
});
