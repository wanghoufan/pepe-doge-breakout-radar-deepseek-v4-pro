/**
 * V2 历史重算 + 样本扫描 + 回测（一次性离线脚本）。
 *
 * 运行：node --import tsx scripts/recompute-v2.ts
 *
 * 产出：
 *  1) 用 V2 rolling detector 重算 21 个历史事件，写入 src/data/event-metrics.json（覆盖）。
 *  2) 全量历史突破扫描（成功/失败/普通样本）+ walk-forward 回测。
 *  3) BEFORE/AFTER 对比 + 回测结果，写入 scripts/output/recompute-report.json。
 *  4) 终端打印关键结果。
 */
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_DEFS, computeEventMetrics } from '../src/lib/event-analysis';
import { scanBreakoutSamples, labelBreakoutOutcomes, findNormalWindows, type BreakoutSample } from '../src/lib/v2/samples';
import { walkForwardBacktest, summarizeWalkForward } from '../src/lib/v2/backtest';
import { percentile } from '../src/lib/statistics';
import type { Candle } from '../src/lib/types';

const dataDir = path.resolve(process.cwd(), 'src/data');
const outDir = path.resolve(process.cwd(), 'scripts/output');

function load<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T;
}

const pepeBars = load<Candle[]>('candles/pepe-usdt-swap.json');
const dogeBars = load<Candle[]>('candles/doge-usdt-swap.json');
const btcBars = load<Candle[]>('candles/btc-usdt-swap.json');
const pepeFunding = load<{ ts: number; rate: number }[]>('funding/1000pepeusdt.json');
const dogeFunding = load<{ ts: number; rate: number }[]>('funding/dogeusdt.json');

interface OldMetric {
  id: string;
  coin: string;
  startTs: number;
  endTs: number;
  breakoutTs: number | null;
  first48AvgVolRatio: number | null;
  relativePeakVsBtc: number | null;
  coinPeakReturn: number | null;
  [k: string]: unknown;
}
const oldMetrics = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'scripts/output/event-metrics-v1-backup.json'), 'utf8'),
) as OldMetric[];
const oldById = new Map(oldMetrics.map((m) => [m.id, m]));

// ---------- 1) 重算 21 事件 ----------
const newMetrics = EVENT_DEFS.map((def) =>
  computeEventMetrics(
    def,
    def.coin === 'PEPE' ? pepeBars : dogeBars,
    btcBars,
    def.coin === 'PEPE' ? pepeFunding : dogeFunding,
  ),
);

// ---------- 2) 全量突破扫描 ----------
const pepeSamples = scanBreakoutSamples('PEPE', pepeBars);
const dogeSamples = scanBreakoutSamples('DOGE', dogeBars);
const allSamples = [...pepeSamples, ...dogeSamples];

// MFE/MAE 分布（用于确定 outcome 阈值）
const mfe72 = allSamples.map((s) => s.mfe72h).filter((v): v is number => v != null);
const mae72 = allSamples.map((s) => s.mae72h).filter((v): v is number => v != null);
const dist = {
  count: allSamples.length,
  pepe: pepeSamples.length,
  doge: dogeSamples.length,
  mfe72Percentiles: {
    p10: percentile(mfe72, 10),
    p25: percentile(mfe72, 25),
    p50: percentile(mfe72, 50),
    p75: percentile(mfe72, 75),
    p90: percentile(mfe72, 90),
  },
  mae72Percentiles: {
    p10: percentile(mae72, 10),
    p25: percentile(mae72, 25),
    p50: percentile(mae72, 50),
    p75: percentile(mae72, 75),
    p90: percentile(mae72, 90),
  },
};

// outcome 阈值（基于分布：成功 = 72h MFE ≥ 10% 且 72h 回撤不超过 8%）
const SUCCESS_MFE = 10; // 72h MFE ≥ 10%
const SUCCESS_MAE = -8; // 72h MAE ≥ -8%（回撤不超过 8%）

labelBreakoutOutcomes(allSamples, {
  successMfe72hPct: SUCCESS_MFE,
  successMae72hPct: SUCCESS_MAE,
});
const labeled = allSamples.filter((s) => s.outcome != null);
const successCount = labeled.filter((s) => s.outcome === 'success').length;
const failureCount = labeled.filter((s) => s.outcome === 'failure').length;
const unlabeled = allSamples.length - labeled.length;

// 普通窗口
const normalP = findNormalWindows(pepeBars, 30);
const normalD = findNormalWindows(dogeBars, 30);

// ---------- 3) walk-forward 回测 ----------
const folds = walkForwardBacktest(allSamples, 5);
const summary = summarizeWalkForward(folds);

// ---------- 4) 把 outcome 写回 21 事件（用于页面展示） ----------
// 21 事件中，凡其 breakout 命中了「成功/失败」标签的样本，就带上 outcome。
const samplesByTs = new Map<string, BreakoutSample[]>();
for (const s of allSamples) {
  const k = s.coin;
  if (!samplesByTs.has(k)) samplesByTs.set(k, []);
  samplesByTs.get(k)!.push(s);
}
for (const m of newMetrics) {
  if (m.breakoutTs == null) {
    m.outcome = null;
    continue;
  }
  const list = samplesByTs.get(m.coin) ?? [];
  const hit = list.find((s) => Math.abs(s.ts - (m.breakoutTs as number)) < 14_400_000);
  m.outcome = hit?.outcome ?? null;
}

// ---------- 5) BEFORE/AFTER 对比 ----------
const comparison = newMetrics.map((m) => {
  const old = oldById.get(m.id);
  const oldBreakoutTs = old?.breakoutTs ?? null;
  const newBreakoutTs = m.breakoutTs ?? null;
  const diffHours =
    oldBreakoutTs != null && newBreakoutTs != null
      ? Math.round(((newBreakoutTs - oldBreakoutTs) / 3_600_000) * 10) / 10
      : null;
  const oldNoBreakout = oldBreakoutTs == null;
  const newNoBreakout = newBreakoutTs == null;
  return {
    id: m.id,
    coin: m.coin,
    oldBreakoutTs,
    newBreakoutTs,
    diffHours,
    oldNoBreakout,
    newNoBreakout,
    oldFollowThrough48h: old?.first48AvgVolRatio ?? null,
    newFollowThrough24h: m.followThrough24hVolRatio,
    newFollowThrough48h: m.followThrough48hVolRatio,
    oldRelativePeakVsBtc: old?.relativePeakVsBtc ?? null,
    newRelativeReturn24h: m.relativeReturn24h,
    newRelativeReturn72h: m.relativeReturn72h,
    oldCoinPeakReturn: old?.coinPeakReturn ?? null,
    newMfe72h: m.mfe72h,
    newMae72h: m.mae72h,
    newMfe7d: m.mfe7d,
    outcome: m.outcome,
  };
});

const nowBothNull = comparison.filter((c) => c.oldNoBreakout && c.newNoBreakout).length;
const oldDetectedNewNot = comparison.filter((c) => !c.oldNoBreakout && c.newNoBreakout).length;
const oldNotNewDetected = comparison.filter((c) => c.oldNoBreakout && !c.newNoBreakout).length;

// ---------- 写文件 ----------
fs.mkdirSync(outDir, { recursive: true });

const newMetricsOut = newMetrics.map((m) => ({ ...m }));
fs.writeFileSync(path.join(dataDir, 'event-metrics.json'), JSON.stringify(newMetricsOut, null, 2));

const report = {
  generatedAt: new Date().toISOString(),
  distribution: dist,
  outcomeThresholds: { successMfe72hPct: SUCCESS_MFE, successMae72hPct: SUCCESS_MAE },
  sampleCounts: { total: allSamples.length, pepe: pepeSamples.length, doge: dogeSamples.length, success: successCount, failure: failureCount, unlabeled },
  normalWindows: { pepe: normalP.length, doge: normalD.length, pepeSamples: normalP.slice(0, 10), dogeSamples: normalD.slice(0, 10) },
  walkForward: { folds, summary },
  comparison,
  breakouts: {
    bothNull: nowBothNull,
    oldDetectedNewNot,
    oldNotNewDetected,
  },
};
fs.writeFileSync(path.join(outDir, 'recompute-report.json'), JSON.stringify(report, null, 2));

// ---------- 终端打印 ----------
console.log('=== 突破样本分布 ===');
console.log(`总突破 ${allSamples.length}（PEPE ${pepeSamples.length} / DOGE ${dogeSamples.length}）`);
console.log(`MFE72h 分位: `, dist.mfe72Percentiles);
console.log(`MAE72h 分位: `, dist.mae72Percentiles);
console.log(`成功 ${successCount} / 失败 ${failureCount} / 未标注 ${unlabeled}`);
console.log(`普通窗口: PEPE ${normalP.length} 段 / DOGE ${normalD.length} 段（≥30 天无突破）`);
console.log('');
console.log('=== walk-forward 汇总（test 集）===');
console.log(JSON.stringify(summary, null, 2));
console.log('');
console.log('=== 突破检测差异 ===');
console.log(`两者均无突破: ${nowBothNull} / 旧有新增无: ${oldDetectedNewNot} / 旧无新有: ${oldNotNewDetected}`);
console.log('');
console.log('=== BEFORE/AFTER（节选）===');
for (const c of comparison) {
  console.log(
    `${c.id} ${c.coin} | oldBt=${c.oldBreakoutTs ? new Date(c.oldBreakoutTs).toISOString().slice(0, 16) : '—'} ` +
      `newBt=${c.newBreakoutTs ? new Date(c.newBreakoutTs).toISOString().slice(0, 16) : '—'} ` +
      `diff=${c.diffHours == null ? '—' : c.diffHours + 'h'} | ` +
      `oldFT48=${c.oldFollowThrough48h?.toFixed(2) ?? '—'} newFT24=${c.newFollowThrough24h?.toFixed(2) ?? '—'} | ` +
      `oldRel=${c.oldRelativePeakVsBtc?.toFixed(1) ?? '—'} newRel72=${c.newRelativeReturn72h?.toFixed(1) ?? '—'} | ` +
      `oldRet=${c.oldCoinPeakReturn?.toFixed(0) ?? '—'}% newMFE72=${c.newMfe72h?.toFixed(1) ?? '—'}% newMAE72=${c.newMae72h?.toFixed(1) ?? '—'}% ` +
      `outcome=${c.outcome ?? '—'}`,
  );
}
console.log('');
console.log(`报告已写入 scripts/output/recompute-report.json`);
console.log(`event-metrics.json 已用 V2 重算覆盖`);
