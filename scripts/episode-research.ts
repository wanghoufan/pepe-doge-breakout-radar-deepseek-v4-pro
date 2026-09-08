/**
 * Episode Reset 规则研究（V2 整改 §4）。
 *
 * 比较方案 A（fixed cooldown 24H/48H/72H/7D）、B（return-to-range）、
 * C（ATR/base reset）、D（hybrid，冻结规则）：
 * 输出 raw trigger 数、independent episode 数、triggers/episode 分布、间隔分布。
 *
 * 本脚本是描述性研究，不做模型选择；冻结规则见 BACKTEST_PROTOCOL_V1.md。
 * 运行：node --import tsx scripts/episode-research.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BREAKOUT_CONFIG } from '../src/lib/breakout';
import {
  buildBreakoutEpisodes,
  summarizeRawVsIndependent,
  RESET_RULE_A_24H,
  RESET_RULE_A_48H,
  RESET_RULE_A_72H,
  RESET_RULE_A_7D,
  RESET_RULE_B_RANGE,
  RESET_RULE_C_ATR,
  FROZEN_EPISODE_RULE,
  type EpisodeResetRule,
} from '../src/lib/v2/episode';
import type { Candle } from '../src/lib/types';

const dataDir = path.resolve(process.cwd(), 'src/data');
const outDir = path.resolve(process.cwd(), 'scripts/output');

function load<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8')) as T;
}

const CFG = { ...DEFAULT_BREAKOUT_CONFIG, lookbackCandles: 42 };
const RULES: { name: string; rule: EpisodeResetRule }[] = [
  { name: 'A-24H', rule: RESET_RULE_A_24H },
  { name: 'A-48H', rule: RESET_RULE_A_48H },
  { name: 'A-72H', rule: RESET_RULE_A_72H },
  { name: 'A-7D', rule: RESET_RULE_A_7D },
  { name: 'B-range', rule: RESET_RULE_B_RANGE },
  { name: 'C-atr', rule: RESET_RULE_C_ATR },
  { name: 'D-hybrid(FROZEN)', rule: FROZEN_EPISODE_RULE },
];

function quantile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const s = sorted.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

const coins = ['PEPE', 'DOGE'] as const;
const result: Record<string, unknown> = { generatedAt: new Date().toISOString(), config: CFG, rules: {} };

for (const coin of coins) {
  const bars = load<Candle[]>(`candles/${coin === 'PEPE' ? 'pepe-usdt-swap' : 'doge-usdt-swap'}.json`);
  const perCoin: Record<string, unknown> = {};
  for (const { name, rule } of RULES) {
    const s = summarizeRawVsIndependent(bars, CFG, rule, coin);
    const gapsSorted = s.episodeGapBars.slice().sort((a, b) => a - b);
    const gapsH = gapsSorted.map((g) => g * 4);
    perCoin[name] = {
      rawTriggers: s.rawTriggers,
      episodes: s.episodes,
      inflation: s.episodes ? +(s.rawTriggers / s.episodes).toFixed(2) : null,
      triggersPerEpisode: { mean: s.mean != null ? +s.mean.toFixed(2) : null, median: s.median, p90: s.p90, max: s.max },
      gapHours: {
        median: quantile(gapsH, 50),
        p90: quantile(gapsH, 90),
        max: gapsH.length ? gapsH[gapsH.length - 1] : null,
        le12h: gapsSorted.filter((g) => g <= 3).length,
      },
    };
  }
  result[coin] = perCoin;
  // 冻结规则的 episode 明细（供 EPISODE_ANALYSIS.md）。
  const eps = buildBreakoutEpisodes(bars, CFG, FROZEN_EPISODE_RULE, coin);
  (result as Record<string, unknown>)[`${coin}_frozenEpisodes`] = eps.map((e) => ({
    id: e.id,
    startTs: e.startTs,
    startIso: new Date(e.startTs).toISOString(),
    level: e.level,
    triggers: e.triggers.length,
    resetReason: e.resetReason,
  }));
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'episode-research.json'), JSON.stringify(result, null, 2));

for (const coin of coins) {
  console.log(`=== ${coin} ===`);
  console.log('规则 | raw | episodes | 膨胀比 | T/E mean/med/p90/max | gap med/p90/max(h) | gap≤12H');
  const perCoin = result[coin] as Record<string, Record<string, number | null | Record<string, number | null>>>;
  for (const { name } of RULES) {
    const r = perCoin[name] as unknown as {
      rawTriggers: number; episodes: number; inflation: number;
      triggersPerEpisode: { mean: number; median: number; p90: number; max: number };
      gapHours: { median: number; p90: number; max: number; le12h: number };
    };
    console.log(
      `${name} | ${r.rawTriggers} | ${r.episodes} | ${r.inflation}x | ` +
      `${r.triggersPerEpisode.mean}/${r.triggersPerEpisode.median}/${r.triggersPerEpisode.p90}/${r.triggersPerEpisode.max} | ` +
      `${r.gapHours.median}/${r.gapHours.p90}/${r.gapHours.max} | ${r.gapHours.le12h}`,
    );
  }
  console.log('');
}
console.log('已写入 scripts/output/episode-research.json');
