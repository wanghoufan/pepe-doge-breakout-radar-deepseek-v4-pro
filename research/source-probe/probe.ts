/**
 * P0.0 SOURCE CHARACTERIZATION 非评测探针（§6-P0.0）。
 *
 * 隔离声明（必读）：
 * - 本目录为独立研究探针，与 `src/` 实时 Action 链零导入、零共享模块。
 *   实时链路（market-client / market-service / ActionCard / 报警）禁止 import 本目录任何文件；
 *   本探针亦不 import `src/` 下任何业务模块（含 config.ASSETS —— 下方 SYMBOLS 为解耦快照拷贝，
 *   仅本探针内单一来源，变更不回写业务配置）。
 * - 探针输出（data/*.jsonl / summary）默认禁入任何评测：禁计入 Eligible / 统计分母 / 指标，
 *   仅用于冻结 SOURCE_CADENCE_BASELINE_V1.md 的 cadence 基线。
 * - 范围冻结：标的仅 PEPE / DOGE / ETHFI + BTC 环境参照；交易所仅 OKX（主）+ Binance（备）。
 *   禁新增币种、禁 Bybit / CoinGlass（含常量）。
 * - 本探针不做权重/评分/胜率/收益类输出（Quant NONE）。
 *
 * 观测维度：source event interval、REST latency、WS heartbeat、timestamp 更新规律、
 * rate limit、gap frequency；通道覆盖 OI / trades / mark / funding_current / depth。
 *
 * 用法：
 *   npx tsx research/source-probe/probe.ts --once                  # 单次全扫（连通验证）
 *   npx tsx research/source-probe/probe.ts --cycles 20 --interval-ms 60000
 *   npx tsx research/source-probe/probe.ts                         # 常驻（≥24h 目标，SIGINT 退出并写 summary）
 *   bash research/source-probe/run-24h.sh                          # 后台常驻包装
 *
 * 输出：data/probe-<startTs>.jsonl（逐观测一行）+ data/summary-<startTs>.json（退出时）。
 */

type Coin = 'PEPE' | 'DOGE' | 'ETHFI' | 'BTC';
type Channel = 'oi' | 'trades' | 'mark' | 'funding_current' | 'depth';
type Exchange = 'okx' | 'binance';

/** 解耦快照（见文件头隔离声明）：与业务 ASSETS 同值，但不 import，保证探针独立。 */
const OKX_INST: Record<Coin, string> = {
  PEPE: 'PEPE-USDT-SWAP',
  DOGE: 'DOGE-USDT-SWAP',
  ETHFI: 'ETHFI-USDT-SWAP',
  BTC: 'BTC-USDT-SWAP',
};
/** Binance 备链路 symbol（PEPE 为 1000PEPEUSDT 乘数口径，价格按交易所原始值记录，不自乘）。 */
const BINANCE_SYMBOL: Record<Coin, string> = {
  PEPE: '1000PEPEUSDT',
  DOGE: 'DOGEUSDT',
  ETHFI: 'ETHFIUSDT',
  BTC: 'BTCUSDT',
};

const OKX_HOSTS = ['https://www.okx.com', 'https://aws.okx.com'];
const BINANCE_HOSTS = ['https://fapi.binance.com', 'https://fapi1.binance.com'];
const TIMEOUT_MS = 8000;

/** funding 通道仅交易标的（BTC 按产品语义无资金费率基线，记 N/A，见基线文件）。 */
const FUNDING_COINS: Coin[] = ['PEPE', 'DOGE', 'ETHFI'];
const ALL_COINS: Coin[] = ['PEPE', 'DOGE', 'ETHFI', 'BTC'];

interface Target {
  exchange: Exchange;
  channel: Channel;
  coin: Coin;
  url: string; // 首选 host 下完整路径（实际请求按 host fallback 逐个尝试）
  paths: string[]; // 各 host 下 path（与 hosts 对齐）
  hosts: string[];
}

function okxPaths(coin: Coin, channel: Channel): string {
  const inst = OKX_INST[coin];
  switch (channel) {
    case 'oi': return `/api/v5/public/open-interest?instId=${inst}`;
    case 'trades': return `/api/v5/market/trades?instId=${inst}&limit=100`;
    case 'mark': return `/api/v5/public/mark-price?instId=${inst}`;
    case 'funding_current': return `/api/v5/public/funding-rate?instId=${inst}&limit=5`;
    case 'depth': return `/api/v5/market/books?instId=${inst}&sz=20`;
  }
}

function binancePaths(coin: Coin, channel: Channel): string {
  const s = BINANCE_SYMBOL[coin];
  switch (channel) {
    case 'oi': return `/fapi/v1/openInterest?symbol=${s}`;
    case 'trades': return `/fapi/v1/aggTrades?symbol=${s}&limit=100`;
    case 'mark': return `/fapi/v1/premiumIndex?symbol=${s}`;
    case 'funding_current': return `/fapi/v1/fundingRate?symbol=${s}&limit=5`;
    case 'depth': return `/fapi/v1/depth?symbol=${s}&limit=20`;
  }
}

function buildTargets(): Target[] {
  const out: Target[] = [];
  for (const coin of ALL_COINS) {
    const channels: Channel[] = ['oi', 'trades', 'mark', 'depth'];
    for (const ch of channels) {
      const p = okxPaths(coin, ch);
      out.push({ exchange: 'okx', channel: ch, coin, url: `${OKX_HOSTS[0]}${p}`, paths: [p], hosts: OKX_HOSTS });
      const bp = binancePaths(coin, ch);
      out.push({ exchange: 'binance', channel: ch, coin, url: `${BINANCE_HOSTS[0]}${bp}`, paths: [bp], hosts: BINANCE_HOSTS });
    }
  }
  for (const coin of FUNDING_COINS) {
    const p = okxPaths(coin, 'funding_current');
    out.push({ exchange: 'okx', channel: 'funding_current', coin, url: `${OKX_HOSTS[0]}${p}`, paths: [p], hosts: OKX_HOSTS });
    const bp = binancePaths(coin, 'funding_current');
    out.push({ exchange: 'binance', channel: 'funding_current', coin, url: `${BINANCE_HOSTS[0]}${bp}`, paths: [bp], hosts: BINANCE_HOSTS });
  }
  return out;
}

/** 从响应体提取源事件时间（毫秒）。返回 null = 无可用源 ts（记 timestamp 缺失）。 */
function extractEventTime(exchange: Exchange, channel: Channel, body: unknown): number | null {
  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  try {
    if (exchange === 'okx') {
      const b = body as { code?: string; data?: Record<string, unknown>[] };
      if (!b || b.code !== '0' || !Array.isArray(b.data) || !b.data.length) return null;
      const d = b.data as Record<string, unknown>[];
      switch (channel) {
        case 'oi': return num(d[0]['ts']);
        case 'trades': {
          // trades 为降序（最新在前），取首条 ts
          const ts = d.map((r) => num(r['ts'])).filter((v): v is number => v != null);
          return ts.length ? Math.max(...ts) : null;
        }
        case 'mark': return num(d[0]['ts']);
        case 'funding_current': {
          // funding-rate 返回按时间升序，取末条 fundingTime
          const ts = d.map((r) => num(r['fundingTime'])).filter((v): v is number => v != null);
          return ts.length ? Math.max(...ts) : null;
        }
        case 'depth': return num(d[0]['ts']);
      }
    } else {
      switch (channel) {
        case 'oi': return num((body as { time?: unknown })?.time);
        case 'trades': {
          const arr = body as { T?: unknown }[];
          if (!Array.isArray(arr) || !arr.length) return null;
          const ts = arr.map((r) => num(r['T'])).filter((v): v is number => v != null);
          return ts.length ? Math.max(...ts) : null;
        }
        case 'mark': return num((body as { time?: unknown })?.time);
        case 'funding_current': {
          const arr = body as { fundingTime?: unknown }[];
          if (!Array.isArray(arr) || !arr.length) return null;
          const ts = arr.map((r) => num(r['fundingTime'])).filter((v): v is number => v != null);
          return ts.length ? Math.max(...ts) : null;
        }
        case 'depth': return num((body as { T?: unknown })?.T);
      }
    }
  } catch { return null; }
  return null;
}

type ErrorKind = 'none' | 'timeout' | 'dns' | 'network' | 'http_status' | 'bad_body' | 'rate_limit';

function classifyError(err: unknown): { kind: ErrorKind; detail: string } {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  const name = e?.name ?? '';
  const msg = e?.message ?? 'unknown';
  if (name === 'TimeoutError' || name === 'AbortError') return { kind: 'timeout', detail: `timeout: ${msg}` };
  if (msg.startsWith('http_429') || msg.startsWith('http_418')) return { kind: 'rate_limit', detail: msg };
  if (msg.startsWith('http_')) return { kind: 'http_status', detail: msg };
  const code = (e?.cause as { code?: string } | undefined)?.code;
  const raw = [msg, (e?.cause as { message?: string } | undefined)?.message].filter(Boolean).join(' / ');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /getaddrinfo/i.test(raw)) return { kind: 'dns', detail: `dns: ${raw}` };
  return { kind: 'network', detail: raw.slice(0, 300) };
}

export interface Observation {
  kind: 'rest';
  probe_cycle: number;
  exchange: Exchange;
  channel: Channel;
  coin: Coin;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  vendorCode: string | null;
  errorKind: ErrorKind;
  errorDetail: string | null;
  latencyMs: number;
  rateLimited: boolean;
  /** 源事件时间（毫秒，null = 响应无可用源 ts）。 */
  event_time_ms: number | null;
  receive_time_ms: number;
  /** 相对上次同 target 成功观测：源 ts 是否前进。 */
  event_advanced: boolean | null;
  /** 相对上次同 target 成功观测的源 ts 差值（毫秒，null = 不可比）。 */
  event_delta_ms: number | null;
  cached?: never;
}

async function fetchTarget(t: Target, cycle: number, prevEvent: Map<string, number>): Promise<Observation> {
  const key = `${t.exchange}|${t.channel}|${t.coin}`;
  const receive_time_ms = Date.now();
  let lastErr: { kind: ErrorKind; detail: string } = { kind: 'network', detail: 'no attempt' };
  let lastStatus: number | null = null;
  let lastUrl = t.url;
  for (let i = 0; i < t.hosts.length; i++) {
    const url = `${t.hosts[i]}${t.paths[0]}`;
    lastUrl = url;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' }, cache: 'no-store' });
      const latencyMs = Date.now() - t0;
      lastStatus = res.status;
      const rl = res.status === 429 || res.status === 418;
      if (!res.ok) {
        lastErr = res.status === 429 || res.status === 418
          ? { kind: 'rate_limit', detail: `http_${res.status}` }
          : { kind: 'http_status', detail: `http_${res.status}` };
        if (i === t.hosts.length - 1) {
          return base(t, cycle, lastUrl, false, lastStatus, null, lastErr.kind, lastErr.detail, latencyMs, rl, null, receive_time_ms, null, null);
        }
        continue;
      }
      const body: unknown = await res.json();
      const evt = extractEventTime(t.exchange, t.channel, body);
      let vendorCode: string | null = null;
      if (t.exchange === 'okx') vendorCode = (body as { code?: string })?.code ?? null;
      if (evt == null) {
        return base(t, cycle, lastUrl, false, lastStatus, vendorCode, 'bad_body', 'missing source ts', latencyMs, rl, null, receive_time_ms, null, null);
      }
      const prev = prevEvent.get(key);
      const event_advanced = prev == null ? null : evt > prev;
      const event_delta_ms = prev == null ? null : evt - prev;
      prevEvent.set(key, evt);
      return base(t, cycle, lastUrl, true, lastStatus, vendorCode, 'none', null, latencyMs, rl, evt, receive_time_ms, event_advanced, event_delta_ms);
    } catch (err) {
      const c = classifyError(err);
      lastErr = c;
      lastStatus = null;
    }
  }
  return base(t, cycle, lastUrl, false, lastStatus, null, lastErr.kind, lastErr.detail, Date.now() - receive_time_ms, lastErr.kind === 'rate_limit', null, receive_time_ms, null, null);
}

function base(
  t: Target, cycle: number, url: string, ok: boolean, httpStatus: number | null,
  vendorCode: string | null, errorKind: ErrorKind, errorDetail: string | null,
  latencyMs: number, rateLimited: boolean, event_time_ms: number | null,
  receive_time_ms: number, event_advanced: boolean | null, event_delta_ms: number | null,
): Observation {
  return {
    kind: 'rest', probe_cycle: cycle, exchange: t.exchange, channel: t.channel, coin: t.coin,
    url, ok, httpStatus, vendorCode, errorKind, errorDetail, latencyMs, rateLimited,
    event_time_ms, receive_time_ms, event_advanced, event_delta_ms,
  };
}

/* ---------------- WS 存活探测（短窗口采样，不做连续订阅） ---------------- */

export interface WsObservation {
  kind: 'ws';
  probe_cycle: number;
  exchange: Exchange;
  channel: string;
  coin: Coin;
  url: string;
  ok: boolean;
  errorDetail: string | null;
  /** 首条业务消息时延（毫秒，null = 未收到）。 */
  timeToFirstMsgMs: number | null;
  msgCount: number;
  /** 相邻消息间隔（毫秒）统计，null = 样本不足。 */
  intervalMeanMs: number | null;
  intervalP95Ms: number | null;
  /** 是否完成一次 ping/pong（OKX 主动 ping；Binance 靠原生 pong）。 */
  heartbeatOk: boolean | null;
  windowMs: number;
  receive_time_ms: number;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, i)];
}

async function wsProbe(
  exchange: Exchange, channel: string, coin: Coin, url: string,
  subscribe: Record<string, unknown>, msgOk: (m: unknown) => boolean,
  windowMs: number, cycle: number,
): Promise<WsObservation> {
  const receive_time_ms = Date.now();
  const fail = (detail: string): WsObservation => ({
    kind: 'ws', probe_cycle: cycle, exchange, channel, coin, url, ok: false, errorDetail: detail,
    timeToFirstMsgMs: null, msgCount: 0, intervalMeanMs: null, intervalP95Ms: null,
    heartbeatOk: null, windowMs, receive_time_ms,
  });
  try {
    const WS = (globalThis as unknown as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) return fail('runtime without WebSocket');
    const ws = new WS(url);
    const stamps: number[] = [];
    let firstAt: number | null = null;
    let heartbeatOk: boolean | null = null;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), TIMEOUT_MS);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('connect error')); }, { once: true });
    });
    ws.send(JSON.stringify(subscribe));
    const t0 = Date.now();
    await new Promise<void>((resolve) => {
      const done = setTimeout(() => resolve(), windowMs);
      ws.addEventListener('message', (ev: MessageEvent) => {
        try {
          const m = JSON.parse(String((ev as MessageEvent).data));
          if (exchange === 'okx' && (m as { event?: string }).event === 'subscribe') return;
          if (exchange === 'okx' && (m as { event?: string }).event === 'ping') { heartbeatOk = true; ws.send(JSON.stringify({ event: 'pong' })); return; }
          if (!msgOk(m)) return;
          const now = Date.now();
          if (firstAt == null) firstAt = now;
          stamps.push(now);
        } catch { /* ignore malformed */ }
      });
      ws.addEventListener('error', () => { clearTimeout(done); resolve(); });
      // Binance 无应用层 ping：发一次 WS 协议 ping 不能经标准 API 观测，heartbeatOk 保持 null；
      // 此处以“窗口内持续收到业务消息”视为 transport 存活（见基线文件 transport/event 分离口径）。
    });
    try { ws.close(); } catch { /* noop */ }
    const intervals = stamps.slice(1).map((t, i) => t - stamps[i]);
    const sorted = [...intervals].sort((a, b) => a - b);
    return {
      kind: 'ws', probe_cycle: cycle, exchange, channel, coin, url,
      ok: stamps.length > 0, errorDetail: stamps.length ? null : 'no business message in window',
      timeToFirstMsgMs: firstAt == null ? null : firstAt - t0,
      msgCount: stamps.length,
      intervalMeanMs: intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : null,
      intervalP95Ms: percentile(sorted, 95),
      heartbeatOk, windowMs, receive_time_ms,
    };
  } catch (err) {
    return fail((err as Error)?.message ?? 'ws failed');
  }
}

async function runWsSession(cycle: number, windowMs: number): Promise<WsObservation[]> {
  const out: WsObservation[] = [];
  // OKX 主：trades + mark（PEPE 代表标的；WS 节拍按所内同通道跨标的一致，基线按 exchange×field 冻结）。
  out.push(await wsProbe('okx', 'trades', 'PEPE', 'wss://ws.okx.com:8443/ws/v5/public',
    { op: 'subscribe', args: [{ channel: 'trades', instId: OKX_INST.PEPE }] },
    (m) => (m as { arg?: { channel?: string } }).arg?.channel === 'trades', windowMs, cycle));
  out.push(await wsProbe('okx', 'mark', 'PEPE', 'wss://ws.okx.com:8443/ws/v5/public',
    { op: 'subscribe', args: [{ channel: 'mark-price', instId: OKX_INST.PEPE }] },
    (m) => (m as { arg?: { channel?: string } }).arg?.channel === 'mark-price', windowMs, cycle));
  // Binance 备：aggTrade + markPrice（combined stream 单连接双订阅）。
  const bws = await wsProbe('binance', 'trades+mark', 'PEPE', 'wss://fstream.binance.com/stream',
    { method: 'SUBSCRIBE', params: ['1000pepeusdt@aggTrade', '1000pepeusdt@markPrice@1s'], id: 1 },
    (m) => {
      const s = (m as { stream?: string }).stream ?? '';
      return s.endsWith('@aggTrade') || s.endsWith('@markPrice@1s');
    }, windowMs, cycle);
  out.push(bws);
  return out;
}

/* ---------------- 主循环 ---------------- */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function parseArgs(argv: string[]): { once: boolean; cycles: number; intervalMs: number; wsSeconds: number; wsEvery: number } {
  const get = (k: string, d: number): number => {
    const i = argv.indexOf(`--${k}`);
    return i >= 0 && argv[i + 1] != null ? Number(argv[i + 1]) || d : d;
  };
  return {
    once: argv.includes('--once'),
    cycles: get('cycles', 0),
    intervalMs: get('interval-ms', 60_000),
    wsSeconds: get('ws-seconds', 20),
    wsEvery: get('ws-every', 30),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dir = join(process.cwd(), 'research/source-probe/data');
  mkdirSync(dir, { recursive: true });
  const startTs = Date.now();
  const stamp = new Date(startTs).toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const jsonlPath = join(dir, `probe-${stamp}.jsonl`);
  const targets = buildTargets();
  console.log(`[probe] targets=${targets.length} (okx+binance × oi/trades/mark/funding_current/depth)`);
  console.log(`[probe] mode=${args.once ? 'once' : `loop interval=${args.intervalMs}ms cycles=${args.cycles || '∞'}`}, ws=${args.wsSeconds}s every ${args.wsEvery} cycles`);
  console.log(`[probe] out=${jsonlPath}`);

  const prevEvent = new Map<string, number>();
  let cycle = 0;
  let stopped = false;
  process.on('SIGINT', () => { stopped = true; });

  const write = (o: unknown) => appendFileSync(jsonlPath, JSON.stringify(o) + '\n');

  const runCycle = async (): Promise<void> => {
    cycle += 1;
    const c0 = Date.now();
    // REST 全扫（顺序执行：避免自制造并发限流；单 target 超时 8s 上限可控）。
    for (const t of targets) {
      const o = await fetchTarget(t, cycle, prevEvent);
      write(o);
    }
    // WS 短窗口采样（首 cycle + 每 wsEvery 个 cycle）。
    if (cycle === 1 || (args.wsEvery > 0 && cycle % args.wsEvery === 0)) {
      const wsObs = await runWsSession(cycle, args.wsSeconds * 1000);
      for (const o of wsObs) write(o);
    }
    console.log(`[probe] cycle=${cycle} elapsed=${Date.now() - c0}ms`);
  };

  if (args.once) {
    await runCycle();
  } else {
    while (!stopped) {
      await runCycle();
      if (args.cycles > 0 && cycle >= args.cycles) break;
      // 等待到下一采集边界（固定节拍，漂移不累积）。
      const nextAt = startTs + cycle * args.intervalMs;
      const wait = nextAt - Date.now();
      if (wait > 0) await sleep(wait);
    }
  }

  // 退出时写轻量 summary（summarize.ts 做全量统计；此处只记运行元信息）。
  const summaryPath = join(dir, `summary-${stamp}.json`);
  writeFileSync(summaryPath, JSON.stringify({
    kind: 'run_meta', startedAt: startTs, endedAt: Date.now(), cycles: cycle,
    targets: targets.length, jsonl: jsonlPath, intervalMs: args.intervalMs,
    note: 'PROBE DATA — 禁入评测（禁计入 Eligible / 统计分母 / 指标），仅用于 cadence 基线冻结。',
  }, null, 2) + '\n');
  console.log(`[probe] done cycles=${cycle} summary=${summaryPath}`);
}

main().catch((e) => { console.error('[probe] fatal', e); process.exit(1); });
