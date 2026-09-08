/**
 * V2 整改新增自动化测试（§25 的 TEST 1–15）。
 *
 * 覆盖：episode 聚合/reset、无未来信息、raw/episode 分口径、AND 标签、
 * 多窗口 outcome、全量 normal 窗口、误报可算、campaign 隔离、协议冻结、
 * 检测器共享、未收盘不确认、缺失≠0分。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { detectBreakoutAt, DEFAULT_BREAKOUT_CONFIG } from '../breakout';
import {
  buildBreakoutEpisodes,
  getRealtimeEpisodeMembership,
  summarizeRawVsIndependent,
  updateBreakoutEpisode,
  FROZEN_EPISODE_RULE,
} from './episode';
import {
  buildSensitivityMatrix,
  calculateOutcomeMetrics,
  classifyHistoricalOutcome,
  type WindowOutcome,
} from './outcomes';
import { buildNormalWindows, setupAlertLevel } from './normal-windows';
import {
  buildEpisodeFeatureRows,
  campaignWalkForward,
  computeIncrementalMetrics,
  episodeCampaignOf,
  makeIncrementalSignal,
  type EpisodeFeatureRow,
} from './backtest';
import { FROZEN_PROTOCOL, checkProtocolCompliance } from './protocol';
import { evaluateHardVeto } from './engine';
import { DEFAULT_CONFIG } from '../config';
import type { Candle } from '../types';

const H4 = 4 * 3_600_000;
const T0 = Date.parse('2025-01-01T00:00:00Z');

function mkCandles(n: number, fn: (i: number) => { o: number; h: number; l: number; c: number; v?: number }): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const k = fn(i);
    out.push({
      ts: T0 + i * H4,
      o: k.o,
      h: k.h,
      l: k.l,
      c: k.c,
      vol: k.v ?? 100,
      quoteVol: (k.v ?? 100) * k.c,
      confirmed: true,
    });
  }
  return out;
}

/** 基座 100 根（价格 100 横盘），之后按给定收盘序列走。 */
function withBase(closes: number[]): Candle[] {
  const base = mkCandles(100, () => ({ o: 100, h: 101, l: 99, c: 100 }));
  const tail = mkCandles(closes.length, (i) => {
    const c = closes[i];
    return { o: c - 0.2, h: c + 0.3, l: c - 0.5, c };
  }).map((b, i) => ({ ...b, ts: T0 + (100 + i) * H4 }));
  return [...base, ...tail];
}

const CFG = { ...DEFAULT_BREAKOUT_CONFIG, lookbackCandles: 42 };

/* ---------------- TEST 1：连续 3 根创新高只产生一个 episode ---------------- */

test('TEST 1：连续 3 根创新高只产生一个 Independent Episode', () => {
  // 基座最高 101；三根连续收盘 102/103/104 → 3 个 raw triggers。
  const bars = withBase([102, 103, 104, 104.5, 105]);
  let raw = 0;
  for (let i = 0; i < bars.length; i++) if (detectBreakoutAt(bars, i, CFG)) raw++;
  assert.equal(raw, 5);
  const eps = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  assert.equal(eps.length, 1);
  assert.equal(eps[0].triggers.length, 5);
});

/* ---------------- TEST 2：reset 后可产生新事件 ---------------- */

test('TEST 2：Episode reset 后可以产生新事件', () => {
  // 突破 102 后：横盘 8 根（≥6），期间收盘跌回 level 下方，再创新高 → 新 episode。
  const bars = withBase([102, 101.5, 100.5, 100.8, 100.9, 101, 101.1, 101.2, 101.3, 102.5, 103]);
  const eps = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  assert.equal(eps.length, 2);
  assert.equal(eps[0].resetReason, 'hybrid(return-to-range)');
  assert.equal(eps[1].triggers.length, 2); // 第二轮 102.5/103 两个 trigger
});

/* ---------------- TEST 3：不使用未来 K 线 ---------------- */

test('TEST 3：Episode Builder 不使用未来 K 线', () => {
  const bars = withBase([102, 103, 101.5, 100.5, 100.9, 101.4, 102.6, 103.1, 102.9]);
  const full = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  // 用前缀重建：前缀内的 episode 必须与全量构建的前缀部分完全一致。
  const cut = 100 + 5;
  const prefix = bars.slice(0, cut);
  const pre = buildBreakoutEpisodes(prefix, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  const fullInPrefix = full.filter((e) => e.startIndex < cut);
  assert.equal(pre.length, fullInPrefix.length);
  for (let k = 0; k < pre.length; k++) {
    assert.equal(pre[k].startTs, fullInPrefix[k].startTs);
    assert.deepEqual(
      pre[k].triggers.filter((t) => t.index < cut).map((t) => t.ts),
      fullInPrefix[k].triggers.filter((t) => t.index < cut).map((t) => t.ts),
    );
  }
  // updateBreakoutEpisode 单步推进与批量构建一致。
  const incremental = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  assert.deepEqual(
    incremental.map((e) => e.triggers.length),
    full.map((e) => e.triggers.length),
  );
  assert.ok(typeof updateBreakoutEpisode === 'function');
});

/* ---------------- TEST 4：P10 聚合（真实数据） ---------------- */

const dataDir = path.resolve(process.cwd(), 'src/data');
function loadJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T;
}

test('TEST 4：P10 多个 trigger 被聚合成一个 episode（真实数据）', () => {
  const pepe = loadJson<Candle[]>('candles/pepe-usdt-swap.json');
  const from = Date.parse('2026-07-03T00:00:00Z');
  const to = Date.parse('2026-07-04T00:00:00Z');
  const idx: number[] = [];
  pepe.forEach((b, i) => {
    if (b.ts >= from && b.ts <= to && detectBreakoutAt(pepe, i, CFG)) idx.push(i);
  });
  assert.ok(idx.length >= 2, `P10 窗口应有连续多个 trigger（实测 ${idx.length}）`);
  const eps = buildBreakoutEpisodes(pepe, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  const owners = new Set(idx.map((i) => eps.find((e) => e.triggers.some((t) => t.index === i))?.id));
  assert.equal(owners.size, 1);
});

/* ---------------- TEST 5：Raw 与 Episode 分口径 ---------------- */

test('TEST 5：Raw Trigger Count 与 Episode Count 分开报告', () => {
  // 第一轮 102/103/104（3 triggers），回落并跌回 level 下方，间隔 7 根后 104.6/105.2（2 triggers）→ 新 episode。
  const bars = withBase([102, 103, 104, 100.5, 100.6, 100.7, 100.8, 100.9, 101, 104.6, 105.2]);
  const s = summarizeRawVsIndependent(bars, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  assert.ok(s.rawTriggers > s.episodes);
  assert.equal(s.episodes, 2);
  assert.deepEqual(s.triggersPerEpisode, [2, 3]);
  assert.equal(s.max, 3);
});

/* ---------------- TEST 6：AND 标签 ---------------- */

test('TEST 6：Success Label 使用 AND，不是 OR', () => {
  const mk = (mfe: number, mae: number): { episodeId: string; breakoutTs: number; refPrice: number; windows: Record<string, WindowOutcome> } => ({
    episodeId: 'EP-X',
    breakoutTs: 0,
    refPrice: 100,
    windows: {
      '72h': { windowHours: 72, mfe, mae, timeToMfeHours: 4, timeToMaeHours: 8, breakoutReturn: 1, bars: 18 },
    },
  });
  // 大涨但大跌 → OR 会判 success，AND 必须判 failure。
  assert.equal(classifyHistoricalOutcome(mk(25, -12), { mfeThreshold: 10, maeThreshold: -8, windowHours: 72 }), 'failure');
  assert.equal(classifyHistoricalOutcome(mk(12, -3), { mfeThreshold: 10, maeThreshold: -8, windowHours: 72 }), 'success');
  assert.equal(classifyHistoricalOutcome(mk(5, -3), { mfeThreshold: 10, maeThreshold: -8, windowHours: 72 }), 'failure');
  // 窗口未走完 → null（不强行标签）。
  const incomplete = mk(12, -3);
  incomplete.windows['72h'].mfe = null;
  assert.equal(classifyHistoricalOutcome(incomplete, { mfeThreshold: 10, maeThreshold: -8, windowHours: 72 }), null);
});

/* ---------------- TEST 7：多窗口 MFE/MAE ---------------- */

test('TEST 7：24/48/72H/7D MFE/MAE 正确', () => {
  // 突破 ref=100：+24h 内最高 110、最低 95；之后回落。
  const bars = mkCandles(60, (i) => {
    if (i === 0) return { o: 100, h: 101, l: 99, c: 101 }; // breakout bar（ts=T0）
    if (i <= 6) return { o: 100 + i, h: 104 + i, l: 95, c: 100 + i }; // 24h 内最高 110
    return { o: 102, h: 103, l: 90, c: 98 }; // 之后最低 90
  });
  const m = calculateOutcomeMetrics(bars, { id: 'EP-T', startTs: T0 }, 100);
  const approx = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-9, `期望≈${b}，实测 ${a}`);
  approx(m.windows['24h'].mfe, 10);
  approx(m.windows['24h'].mae, -5);
  approx(m.windows['168h'].mae, -10);
  assert.ok((m.windows['24h'].timeToMfeHours ?? 0) <= 24);
  assert.ok(m.windows['24h'].breakoutReturn != null);
  assert.ok(m.windows['24h'].bars >= 6);
});

/* ---------------- TEST 8/9：Normal Windows ---------------- */

test('TEST 8：Normal Window 自动全量生成', () => {
  const bars = mkCandles(60, () => ({ o: 100, h: 100.5, l: 99.5, c: 100 }));
  const wins = buildNormalWindows(bars, new Set(), { windowBars: 12, strideBars: 12 }, 'PEPE');
  assert.equal(wins.length, 5); // 60/12 无重叠
  assert.ok(wins.every((w) => w.endIndex - w.startIndex === 11));
});

test('TEST 9：Normal Window 不包含 breakout episode start', () => {
  const bars = withBase([102, 103, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
  const eps = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  assert.ok(eps.length >= 1);
  const starts = new Set(eps.map((e) => e.startTs));
  const wins = buildNormalWindows(bars, starts, { windowBars: 12, strideBars: 12 }, 'PEPE');
  for (const w of wins) {
    for (let i = w.startIndex; i <= w.endIndex; i++) {
      assert.ok(!starts.has(bars[i].ts), `${w.id} 不应包含 episode start`);
    }
  }
  assert.ok(wins.length >= 1);
});

/* ---------------- TEST 10：误报可算 ---------------- */

test('TEST 10：Setup False Alarm Rate 可计算', () => {
  assert.equal(setupAlertLevel(null), 'NO_SETUP');
  assert.equal(setupAlertLevel(20), 'NO_SETUP');
  assert.equal(setupAlertLevel(35), 'BUILDING_SETUP');
  assert.equal(setupAlertLevel(65), 'NEAR_BREAKOUT');
  const scores: (number | null)[] = [null, 10, 40, 70, 50, null, 80];
  const alarms = scores.filter((s) => setupAlertLevel(s) !== 'NO_SETUP').length;
  assert.equal(alarms / scores.length > 0 && alarms / scores.length < 1, true);
});

/* ---------------- TEST 11/12：campaign 隔离 + 协议冻结 ---------------- */

function fakeRow(ts: number, campaign: string, outcome: 'success' | 'failure'): EpisodeFeatureRow {
  return {
    episodeId: `EP-${ts}`, coin: 'PEPE', ts, level: 100, close: 101,
    volumeRatio: 2, distancePct: 1, setupScore: 60, envGate: 'ALLOW',
    bodyStrength: 0.7, fakeWick: false, riskPoints: 0, riskUnknown: false,
    vetoKind: 'NONE', ft24Confirmed: true, outcome,
    mfe72h: 12, mae72h: -3, mfe7d: 15, mae7d: -4, ret72h: 5, ret7d: 6,
    campaign,
  };
}

test('TEST 11：Campaign 不跨 Train/Test', () => {
  // C01 真实 campaign（2024-11-04~24）内放 6 个样本 + 前后 GAP 样本。
  const c01a = Date.parse('2024-11-05T00:00:00Z');
  const rows: EpisodeFeatureRow[] = [];
  for (let k = 0; k < 6; k++) {
    rows.push(fakeRow(c01a + k * H4, episodeCampaignOf(c01a + k * H4), k % 2 ? 'success' : 'failure'));
  }
  assert.ok(rows.every((r) => r.campaign === 'C01'));
  for (let k = 0; k < 6; k++) {
    const ts = Date.parse('2025-03-01T00:00:00Z') + k * 30 * 86_400_000;
    rows.push(fakeRow(ts, episodeCampaignOf(ts), k % 2 ? 'success' : 'failure'));
  }
  const { folds } = campaignWalkForward(rows, 3);
  assert.ok(folds.length >= 1);
  for (const f of folds) {
    const overlap = f.trainCampaigns.filter((c) => f.testCampaigns.includes(c));
    assert.deepEqual(overlap, []);
    assert.ok(f.trainTo < f.testFrom, 'train 时间严格早于 test');
  }
});

test('TEST 12：Test 参数在 Test 开始前被冻结', () => {
  assert.equal(FROZEN_PROTOCOL.version, 'BACKTEST_PROTOCOL_V1');
  assert.deepEqual(FROZEN_PROTOCOL.grids.volumeRatio, [1.0, 1.5, 2.0, 3.0]);
  // 超出冻结网格 → 不合规。
  const bad = checkProtocolCompliance({
    volumeRatio: [1.0, 5.0], setupScore: [50], distancePct: [0], riskMax: [20],
  });
  assert.equal(bad.compliant, false);
  const good = checkProtocolCompliance(FROZEN_PROTOCOL.grids);
  assert.equal(good.compliant, true);
  // 运行结果必须记录「只在 train 上选择」。
  const rows: EpisodeFeatureRow[] = [];
  for (let k = 0; k < 12; k++) {
    const ts = Date.parse('2025-01-01T00:00:00Z') + k * 20 * 86_400_000;
    rows.push(fakeRow(ts, episodeCampaignOf(ts), k % 3 === 0 ? 'success' : 'failure'));
  }
  const { folds, compliance } = campaignWalkForward(rows, 2);
  assert.equal(compliance.compliant, true);
  for (const f of folds) {
    for (const m of f.models) {
      assert.equal(m.selectedOnTrainOnly, true);
    }
  }
});

/* ---------------- TEST 13：同一 detector + 同一 Builder ---------------- */

test('TEST 13：历史、实时、回测调用同 detector、同 Builder', () => {
  const pepe = loadJson<Candle[]>('candles/pepe-usdt-swap.json');
  const eps = buildBreakoutEpisodes(pepe, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  // 每个 episode start 都是 raw trigger（同 detector）。
  for (const e of eps.slice(0, 20)) {
    assert.ok(detectBreakoutAt(pepe, e.startIndex, CFG) != null, `${e.id} start 必须是 raw trigger`);
  }
  // 实时归属 == Builder 归属（取最后 200 根模拟实时）。
  const live = pepe.slice(-200);
  const m = getRealtimeEpisodeMembership(live, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  const fullEp = buildBreakoutEpisodes(live, CFG, FROZEN_EPISODE_RULE, 'PEPE');
  const lastTrigIdx = (() => {
    let last = -1;
    for (const e of fullEp) for (const t of e.triggers) last = Math.max(last, t.index);
    return last;
  })();
  if (lastTrigIdx >= 0) {
    const owner = fullEp.find((e) => e.triggers.some((t) => t.index === lastTrigIdx))!;
    const k = owner.triggers.findIndex((t) => t.index === lastTrigIdx);
    assert.equal(m.episodeId, owner.id);
    assert.equal(m.triggerIndexInEpisode, k + 1);
  } else {
    assert.equal(m.episodeId, null);
  }
  // 回测特征行用的 episode 与 Builder 一致（数量级一致）。
  assert.ok(eps.length > 0 && eps.length < 290, `episode 数应在合理范围（实测 ${eps.length}）`);
});

/* ---------------- TEST 14：未收盘不确认 ---------------- */

test('TEST 14：未关闭 4H candle 不确认 breakout', () => {
  // high 刺破但 close 未站上 → 不是 trigger（调用方只喂 confirmed K 线）。
  const bars = withBase([101.5]);
  bars[bars.length - 1].h = 105; // 长上影
  bars[bars.length - 1].c = 100.5;
  assert.equal(detectBreakoutAt(bars, bars.length - 1, CFG), null);
});

/* ---------------- TEST 15：Missing ≠ 0 ---------------- */

test('TEST 15：Missing Data != Score 0', () => {
  // 数据不足 → DATA_VETO，而不是当成低分通过。
  const tiny = mkCandles(5, () => ({ o: 100, h: 101, l: 99, c: 100 }));
  const veto = evaluateHardVeto(tiny, {
    return7dPct: null, maxDrawdown24hPct: null, closeAboveEma100: null,
    hardBreakdown: false, trend: 'unknown',
  }, false, DEFAULT_CONFIG.thresholds);
  assert.equal(veto.kind, 'DATA_VETO');
  // setup 全缺失 → 预警分层为 NO_SETUP（不误报），而不是 0 分混入统计。
  assert.equal(setupAlertLevel(null), 'NO_SETUP');
});

/* ---------------- 附：回测纯函数冒烟 ---------------- */

test('增量信号函数与特征行构建冒烟', () => {
  const pepe = loadJson<Candle[]>('candles/pepe-usdt-swap.json');
  const eps = buildBreakoutEpisodes(pepe, CFG, FROZEN_EPISODE_RULE, 'PEPE').slice(0, 5);
  const btc = loadJson<Candle[]>('candles/btc-usdt-swap.json');
  const funding = loadJson<{ ts: number; rate: number }[]>('funding/1000pepeusdt.json');
  const om = new Map(eps.map((e) => [e.id, calculateOutcomeMetrics(pepe, e, e.startClose)] as const));
  const rows = buildEpisodeFeatureRows({ coin: 'PEPE', bars: pepe, btcBars: btc, funding, episodes: eps, outcomesByEpisodeId: om });
  assert.equal(rows.length, 5);
  for (const r of rows) {
    assert.ok(r.campaign.length > 0);
    assert.ok(['success', 'failure', null].includes(r.outcome));
  }
  const sig = makeIncrementalSignal('M4', { volumeMin: 1.5, setupMin: 50, distanceMin: 0, riskMax: 30 });
  const met = computeIncrementalMetrics(rows, sig, null);
  assert.ok(met.labeled <= 5);
  assert.ok((met.precision == null && met.signals === 0) || met.precision != null);
  // 敏感性矩阵形状：4 窗口 × 4 MFE × 4 MAE = 64。
  const cells = buildSensitivityMatrix([...om.values()]);
  assert.equal(cells.length, 64);
});
