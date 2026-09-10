/**
 * 前向采集常驻入口（独立进程；探针进程不动）：
 *   npx tsx research/forward-collect/collect.ts --once            # 单轮（冒烟/验证）
 *   npx tsx research/forward-collect/collect.ts --cycles 5        # 短跑
 *   npx tsx research/forward-collect/collect.ts                   # 常驻（60s 节拍，SIGINT 退出）
 *
 * 节拍固定 60s（collector_poll FROZEN，禁调参）。输出：
 * `research/forward-store/fwd-<stamp>.jsonl`（{kind:'record'|'anomaly'|'sweep_meta'}）。
 * forward-store 数据为前向 coverage 候选（非探针数据），评测消费前须按 §4.4 出覆盖报告。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { COLLECTOR_POLL_MS, forwardDedup, forwardStore, sweepInto, sweepOnce } from '../../src/lib/research/collector';

function parseArgs(argv: string[]): { once: boolean; cycles: number; intervalMs: number; outDir: string } {
  const get = (k: string, d: number): number => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) || d : d;
  };
  const str = (k: string, d: string): string => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] != null ? String(argv[i + 1]) : d;
  };
  return {
    once: argv.includes('--once'),
    cycles: get('cycles', 0),
    intervalMs: get('interval-ms', COLLECTOR_POLL_MS),
    outDir: str('out', join(process.cwd(), 'research/forward-store')),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.intervalMs !== COLLECTOR_POLL_MS) {
    console.error(`[forward-collect] 拒绝：interval 必须为冻结值 ${COLLECTOR_POLL_MS}ms（禁调参），实得 ${args.intervalMs}`);
    process.exit(2);
  }
  mkdirSync(args.outDir, { recursive: true });
  const stamp = new Date(Date.now()).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const outPath = join(args.outDir, `fwd-${stamp}.jsonl`);
  console.log(`[forward-collect] poll=${args.intervalMs}ms mode=${args.once ? 'once' : `loop cycles=${args.cycles || '∞'}`} out=${outPath}`);
  const t0 = Date.now();
  let cycle = 0;
  let stopped = false;
  // 跨 sweep 连续计数（trades heartbeat / 异常 streak），snapshotId 仍每轮新建。
  const persistent = { failStreaks: new Map<string, number>() };
  process.on('SIGINT', () => {
    stopped = true;
  });
  for (;;) {
    cycle += 1;
    const r = await sweepOnce(undefined, persistent);
    const w = sweepInto(forwardStore, forwardDedup, [...r.records, ...r.anomalies]);
    for (const rec of r.records) appendFileSync(outPath, JSON.stringify({ kind: 'record', ...rec }) + '\n');
    for (const rec of r.anomalies) appendFileSync(outPath, JSON.stringify({ kind: 'anomaly', ...rec }) + '\n');
    const perChannel: Record<string, { ok: number; fail: number }> = r.perChannel;
    appendFileSync(outPath, JSON.stringify({ kind: 'sweep_meta', snapshotId: r.snapshotId, cycle, records: r.records.length, anomalies: r.anomalies.length, inserted: w.inserted, duplicates: w.duplicates, perChannel, validationErrors: r.validationErrors, storeSize: forwardStore.raw.size }) + '\n');
    console.log(`[forward-collect] cycle=${cycle} snapshot=${r.snapshotId} records=${r.records.length} anomalies=${r.anomalies.length} inserted=${w.inserted} dup=${w.duplicates} store=${forwardStore.raw.size} valErr=${r.validationErrors.length}`);
    if (r.validationErrors.length) console.error(`[forward-collect] VALIDATION: ${r.validationErrors.slice(0, 5).join(' | ')}`);
    if (args.once || (args.cycles > 0 && cycle >= args.cycles)) break;
    if (stopped) break;
    const nextAt = t0 + cycle * args.intervalMs;
    const wait = nextAt - Date.now();
    if (wait > 0) await sleep(wait);
  }
  console.log(`[forward-collect] done cycles=${cycle} store=${forwardStore.raw.size}`);
}

main().catch((e) => {
  console.error('[forward-collect] fatal', e);
  process.exit(1);
});
