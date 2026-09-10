/**
 * P0.0 探针统计脚本（非评测用途，仅输出 cadence 基线统计）。
 * 用法：npx tsx research/source-probe/summarize.ts [data/probe-xxx.jsonl]
 * 缺省读取 data/ 下最新的 probe-*.jsonl。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface Rest {
  kind: string; probe_cycle: number; exchange: string; channel: string; coin: string;
  ok: boolean; httpStatus: number | null; vendorCode: string | null; errorKind: string;
  latencyMs: number; rateLimited: boolean; event_time_ms: number | null;
  receive_time_ms: number; event_advanced: boolean | null; event_delta_ms: number | null;
}
interface Ws {
  kind: string; probe_cycle: number; exchange: string; channel: string; coin: string;
  ok: boolean; timeToFirstMsgMs: number | null; msgCount: number;
  intervalMeanMs: number | null; intervalP95Ms: number | null; heartbeatOk: boolean | null;
}

function pct(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
const r1 = (v: number | null): number | null => (v == null ? null : Math.round(v * 10) / 10);

function main(): void {
  const dir = join(process.cwd(), 'research/source-probe/data');
  const arg = process.argv[2];
  let file: string;
  if (arg) {
    file = arg.startsWith('/') ? arg : join(process.cwd(), arg);
  } else {
    const cands = readdirSync(dir).filter((f) => f.startsWith('probe-') && f.endsWith('.jsonl')).sort();
    if (!cands.length) { console.error('[summarize] no probe-*.jsonl in data/'); process.exit(1); }
    file = join(dir, cands[cands.length - 1]);
  }
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const rest = new Map<string, Rest[]>();
  const ws: Ws[] = [];
  const cycles = new Set<number>();
  for (const ln of lines) {
    const o = JSON.parse(ln) as Rest | Ws;
    cycles.add(o.probe_cycle);
    if (o.kind === 'rest') {
      const k = `${o.exchange}|${(o as Rest).channel}|${(o as Rest).coin}`;
      if (!rest.has(k)) rest.set(k, []);
      rest.get(k)!.push(o as Rest);
    } else if (o.kind === 'ws') ws.push(o as Ws);
  }

  console.log(`# file=${file}\n# cycles=${cycles.size} rest_targets=${rest.size} ws_obs=${ws.length}\n`);
  console.log('exchange|channel|coin | n | ok% | lat_p50 | lat_p95 | lat_max | evt_adv% | evtΔ_med | gaps | ratelimit | err_hist');
  for (const [k, arr] of [...rest.entries()].sort()) {
    const n = arr.length;
    const ok = arr.filter((a) => a.ok);
    const lat = ok.map((a) => a.latencyMs).sort((a, b) => a - b);
    const cmp = arr.filter((a) => a.event_advanced != null);
    const adv = arr.filter((a) => a.event_advanced === true).length;
    const gaps = arr.filter((a) => a.ok && a.event_advanced === false).length;
    const deltas = arr.map((a) => a.event_delta_ms).filter((v): v is number => v != null && v >= 0).sort((a, b) => a - b);
    const rl = arr.filter((a) => a.rateLimited).length;
    const hist = new Map<string, number>();
    for (const a of arr) if (!a.ok) hist.set(a.errorKind, (hist.get(a.errorKind) ?? 0) + 1);
    console.log(
      `${k} | ${n} | ${r1((ok.length / n) * 100)} | ${pct(lat, 50)} | ${pct(lat, 95)} | ${lat[lat.length - 1] ?? null} | ` +
      `${cmp.length ? r1((adv / cmp.length) * 100) : 'n/a'} | ${pct(deltas, 50)} | ${gaps} | ${rl} | ${[...hist.entries()].map(([e, c]) => `${e}×${c}`).join(',') || '-'}`,
    );
  }
  if (ws.length) {
    console.log('\nws observations:');
    for (const w of ws) {
      console.log(
        `cycle=${w.probe_cycle} ${w.exchange}|${w.channel}|${w.coin} ok=${w.ok} ` +
        `ttfm=${w.timeToFirstMsgMs} n=${w.msgCount} intMean=${r1(w.intervalMeanMs)} intP95=${r1(w.intervalP95Ms)} hb=${w.heartbeatOk}`,
      );
    }
  }
}

main();
