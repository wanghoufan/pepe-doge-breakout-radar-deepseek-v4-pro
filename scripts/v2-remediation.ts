/**
 * V2 整改总管线（episode → outcome → sensitivity → normal windows → false alarm →
 * incremental backtest → campaign walk-forward）。
 *
 * 运行：node --import tsx scripts/v2-remediation.ts
 *
 * 协议：BACKTEST_PROTOCOL_V1.md（冻结值见 src/lib/v2/protocol.ts）。
 * 本脚本默认只用冻结值；任何偏离必须显式传参并在报告中标注「协议外探索」。
 * 产出：scripts/output/v2-remediation-*.json（各报告的数据源）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BREAKOUT_CONFIG } from '../src/lib/breakout';
import { buildBreakoutEpisodes, summarizeRawVsIndependent, FROZEN_EPISODE_RULE } from '../src/lib/v2/episode';
import {
  calculateOutcomeMetrics,
  classifyHistoricalOutcome,
  buildSensitivityMatrix,
  FROZEN_SUCCESS_LABEL,
} from '../src/lib/v2/outcomes';
import { buildNormalWindows, setupAlertLevel, DEFAULT_NORMAL_WINDOW_CONFIG } from '../src/lib/v2/normal-windows';
import {
  buildEpisodeFeatureRows,
  campaignWalkForward,
  computeIncrementalMetrics,
  makeIncrementalSignal,
  MODEL_DEFS,
  type EpisodeFeatureRow,
  type IncrementalModelId,
} from '../src/lib/v2/backtest';
import { FROZEN_PROTOCOL, checkProtocolCompliance } from '../src/lib/v2/protocol';
import { computeSetupFeatures, scoreSetupLayer } from '../src/lib/v2/engine';
import { DEFAULT_CONFIG } from '../src/lib/config';
import type { Candle } from '../src/lib/types';

const dataDir = path.resolve(process.cwd(), 'src/data');
const outDir = path.resolve(process.cwd(), 'scripts/output');

function load<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T;
}

const CFG = { ...DEFAULT_BREAKOUT_CONFIG, lookbackCandles: FROZEN_PROTOCOL.detectorLookbackCandles };
const compliance = checkProtocolCompliance(FROZEN_PROTOCOL.grids);
if (!compliance.compliant) {
  console.error('协议网格自检失败：', compliance.violations);
  process.exit(1);
}

const coins = ['PEPE', 'DOGE'] as const;
const btcBars = load<Candle[]>('candles/btc-usdt-swap.json');
const t = DEFAULT_CONFIG.thresholds;
const w = DEFAULT_CONFIG.weights;

const allRows: EpisodeFeatureRow[] = [];
const episodeSection: Record<string, unknown> = {};
const normalSection: Record<string, unknown> = {};
const allMetrics = [];
const d01Windows: Record<string, number | null> = {};
let p10check: unknown = null;

for (const coin of coins) {
  const bars = load<Candle[]>(`candles/${coin === 'PEPE' ? 'pepe-usdt-swap' : 'doge-usdt-swap'}.json`).sort(
    (a: Candle, b: Candle) => a.ts - b.ts,
  );
  const funding = load<{ ts: number; rate: number }[]>(`funding/${coin === 'PEPE' ? '1000pepeusdt' : 'dogeusdt'}.json`);

  // ---- 1) episodes ----
  const summary = summarizeRawVsIndependent(bars, CFG, FROZEN_EPISODE_RULE, coin);
  const episodes = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, coin);
  episodeSection[coin] = {
    rawTriggers: summary.rawTriggers,
    episodes: summary.episodes,
    inflation: summary.episodes ? +(summary.rawTriggers / summary.episodes).toFixed(2) : null,
    triggersPerEpisode: { mean: summary.mean, median: summary.median, p90: summary.p90, max: summary.max },
    gapBars: summary.episodeGapBars,
  };

  // ---- 2) outcomes + frozen label ----
  const om = new Map(episodes.map((e) => [e.id, calculateOutcomeMetrics(bars, e, e.startClose)]));
  for (const m of om.values()) allMetrics.push(m);
  const labeled = episodes.map((e) => ({ id: e.id, ts: e.startTs, outcome: classifyHistoricalOutcome(om.get(e.id)!, FROZEN_SUCCESS_LABEL) }));
  const success = labeled.filter((l) => l.outcome === 'success').length;
  const failure = labeled.filter((l) => l.outcome === 'failure').length;
  (episodeSection[coin] as Record<string, unknown>).frozenLabel = {
    ...FROZEN_SUCCESS_LABEL,
    success,
    failure,
    unlabeled: labeled.length - success - failure,
    baseRate: success + failure > 0 ? +(success / (success + failure)).toFixed(4) : null,
  };

  // ---- 3) feature rows ----
  const rows = buildEpisodeFeatureRows({ coin, bars, btcBars, funding, episodes, outcomesByEpisodeId: om });
  allRows.push(...rows);

  // ---- 4) normal windows + setup false alarm ----
  const starts = new Set(episodes.map((e) => e.startTs));
  const wins = buildNormalWindows(bars, starts, DEFAULT_NORMAL_WINDOW_CONFIG, coin, CFG.lookbackCandles);
  const withLookback = wins.filter((x) => x.hasFullLookback);
  let building = 0;
  let near = 0;
  let scored = 0;
  const perMonth = new Map<string, { windows: number; building: number; near: number }>();
  for (const x of withLookback) {
    const pre = bars.slice(0, x.endIndex + 1);
    const btcPre = btcBars.filter((b) => b.ts <= x.endTs);
    const setup = computeSetupFeatures(pre, btcPre, t);
    const s = scoreSetupLayer(setup, t, w);
    const score = s.available > 0 ? Math.round((s.score / s.available) * 100) : null;
    const level = setupAlertLevel(score);
    if (score != null) scored++;
    if (level === 'BUILDING_SETUP') building++;
    if (level === 'NEAR_BREAKOUT') near++;
    const mk = new Date(x.endTs).toISOString().slice(0, 7);
    if (!perMonth.has(mk)) perMonth.set(mk, { windows: 0, building: 0, near: 0 });
    const m = perMonth.get(mk)!;
    m.windows++;
    if (level === 'BUILDING_SETUP') m.building++;
    if (level === 'NEAR_BREAKOUT') m.near++;
  }
  const months = perMonth.size || 1;
  normalSection[coin] = {
    total48hWindows: wins.length,
    scoredWindows: scored,
    buildingSetup: building,
    nearBreakout: near,
    falseAlarmBuilding: scored ? +(building / scored).toFixed(4) : null,
    falseAlarmNear: scored ? +(near / scored).toFixed(4) : null,
    perMonthAvgBuilding: +(building / months).toFixed(2),
    perMonthAvgNear: +(near / months).toFixed(2),
    monthsCovered: months,
    perMonth: [...perMonth.entries()].map(([month, v]) => ({ month, ...v })),
  };

  // ---- 5) D01 / P10 证据 ----
  if (coin === 'DOGE') {
    const d01 = episodes.find((e) => Math.abs(e.startTs - Date.parse('2024-11-06T00:00:00Z')) < 14_400_000);
    if (d01) {
      const m = om.get(d01.id)!;
      for (const k of ['24h', '48h', '72h', '168h'] as const) {
        d01Windows[`D01_MFE_${k}`] = m.windows[k].mfe;
        d01Windows[`D01_MAE_${k}`] = m.windows[k].mae;
        d01Windows[`D01_RET_${k}`] = m.windows[k].breakoutReturn;
      }
      d01Windows.D01_episodeTriggers = d01.triggers.length;
      d01Windows.D01_outcome72h = classifyHistoricalOutcome(m, FROZEN_SUCCESS_LABEL) === 'success' ? 1 : 0;
    }
  }
  if (coin === 'PEPE') {
    const day = episodes.flatMap((e) =>
      e.triggers.filter((tr) => tr.ts >= Date.parse('2026-07-03T00:00:00Z') && tr.ts <= Date.parse('2026-07-04T00:00:00Z')),
    );
    const ownerIds = new Set(
      day.map((tr) => episodes.find((e) => e.triggers.some((x) => x.ts === tr.ts))!.id),
    );
    p10check = { triggersInDay: day.length, distinctEpisodes: ownerIds.size, episodeIds: [...ownerIds] };
  }
}

// ---- 6) 敏感性矩阵 ----
const sensitivity = buildSensitivityMatrix(allMetrics);

// ---- 7) 增量回测 + campaign walk-forward ----
const { folds, compliance: wfCompliance } = campaignWalkForward(allRows, 4, FROZEN_PROTOCOL.grids);

// 全样本增量比较（描述性，非样本外；样本外结论以 folds 为准）。
const fullCompare = MODEL_DEFS.map((d) => {
  if (d.id === 'B0' || d.id === 'B1') {
    const sig = makeIncrementalSignal(d.id, { volumeMin: 0, setupMin: 0, distanceMin: 0, riskMax: 0 });
    return { model: d.id, label: d.label, chosen: null, metrics: computeIncrementalMetrics(allRows, sig, null) };
  }
  // 全样本最优参数仅作参考，禁止当样本外结论。
  let best = { volumeMin: 1.5, setupMin: 50, distanceMin: 0, riskMax: 20 };
  let bestF1 = -1;
  for (const v of FROZEN_PROTOCOL.grids.volumeRatio) {
    for (const s of FROZEN_PROTOCOL.grids.setupScore) {
      for (const dd of FROZEN_PROTOCOL.grids.distancePct) {
        for (const r of FROZEN_PROTOCOL.grids.riskMax) {
          const cand = { volumeMin: v, setupMin: s, distanceMin: dd, riskMax: r };
          const met = computeIncrementalMetrics(allRows, makeIncrementalSignal(d.id as IncrementalModelId, cand), null);
          if (met.f1 != null && met.f1 > bestF1) {
            bestF1 = met.f1;
            best = cand;
          }
        }
      }
    }
  }
  const sig = makeIncrementalSignal(d.id as IncrementalModelId, best);
  const scoreFn = d.id === 'M1' || d.id === 'M2' ? (row: EpisodeFeatureRow) => (d.id === 'M1' ? row.volumeRatio : row.setupScore) : null;
  return { model: d.id, label: d.label, chosen: best, metrics: computeIncrementalMetrics(allRows, sig, scoreFn) };
});

fs.mkdirSync(outDir, { recursive: true });
const write = (name: string, data: unknown) => {
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2));
  console.log(`已写入 scripts/output/${name}`);
};

write('v2-remediation-episodes.json', { generatedAt: new Date().toISOString(), rule: 'hybrid-D', ...episodeSection, p10check });
write('v2-remediation-sensitivity.json', { generatedAt: new Date().toISOString(), label: 'AND', cells: sensitivity });
write('v2-remediation-normal.json', { generatedAt: new Date().toISOString(), ...normalSection });
write('v2-remediation-walkforward.json', { generatedAt: new Date().toISOString(), protocolCompliant: wfCompliance, folds });
write('v2-remediation-incremental.json', {
  generatedAt: new Date().toISOString(),
  note: '全样本比较为描述性；样本外结论以 walk-forward folds 为准',
  models: fullCompare,
});
write('v2-remediation-d01.json', { generatedAt: new Date().toISOString(), ...d01Windows });

console.log('\n=== Raw vs Independent ===');
for (const coin of coins) {
  const e = episodeSection[coin] as { rawTriggers: number; episodes: number; inflation: number; frozenLabel: { success: number; failure: number; baseRate: number } };
  console.log(`${coin}: raw=${e.rawTriggers} episodes=${e.episodes} 膨胀比=${e.inflation}x | 冻结标签 success=${e.frozenLabel.success} failure=${e.frozenLabel.failure} base=${e.frozenLabel.baseRate}`);
}
console.log('\n=== Normal windows / False alarm ===');
for (const coin of coins) {
  const n = normalSection[coin] as { total48hWindows: number; falseAlarmBuilding: number; falseAlarmNear: number; perMonthAvgBuilding: number; perMonthAvgNear: number };
  console.log(`${coin}: 窗口=${n.total48hWindows} BUILDING误报=${n.falseAlarmBuilding} NEAR误报=${n.falseAlarmNear} 月均=${n.perMonthAvgBuilding}/${n.perMonthAvgNear}`);
}
console.log('\n=== Walk-forward folds ===');
for (const f of folds) {
  console.log(`${f.name}: train[${f.trainCampaigns.join(',')}] → test[${f.testCampaigns.join(',')}]`);
  for (const m of f.models) {
    const tm = m.testMetrics;
    console.log(`  ${m.model}: signals=${tm.signals} P=${tm.precision?.toFixed(3) ?? '—'} R=${tm.recall?.toFixed(3) ?? '—'} spec=${tm.specificity?.toFixed(3) ?? '—'} F1=${tm.f1?.toFixed(3) ?? '—'} ${JSON.stringify(m.chosen)}`);
  }
}
