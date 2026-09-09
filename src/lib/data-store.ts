/**
 * 历史数据快照加载（仅服务端使用）。
 * 资料包中的历史 JSON/CSV 作为固定研究快照，不会被实时接口静默覆盖。
 *
 * 注意：本模块引用了较大的历史 K 线 JSON（总计约 2.2MB），
 * 只在 API 路由 / 服务端组件中导入，绝不在客户端组件中 import。
 */
import type { Candle } from './types';
import type { EventMetrics } from './event-analysis';
import { CAMPAIGNS } from './event-analysis';
import { SNAPSHOT_KEYS } from './config';
import eventMetricsRaw from '../data/event-metrics.json';
import pepeRaw from '../data/candles/pepe-usdt-swap.json';
import dogeRaw from '../data/candles/doge-usdt-swap.json';
import btcRaw from '../data/candles/btc-usdt-swap.json';
import pepeFundingRaw from '../data/funding/1000pepeusdt.json';
import dogeFundingRaw from '../data/funding/dogeusdt.json';

/** 快照 K 线原始字段（未含 confirmed）。 */
interface RawCandle {
  ts: number;
  o: number;
  h: number;
  l: number;
  c: number;
  vol: number;
  baseVol: number;
  quoteVol: number;
}

/** 快照模块注册（静态 import，键唯一来源：config.SNAPSHOT_KEYS；null = 无基线快照）。 */
const SNAPSHOT_CANDLES: Record<string, RawCandle[] | null> = {
  'pepe-usdt-swap': pepeRaw as unknown as RawCandle[],
  'doge-usdt-swap': dogeRaw as unknown as RawCandle[],
  'btc-usdt-swap': btcRaw as unknown as RawCandle[],
};
const SNAPSHOT_FUNDING: Record<string, { ts: number; rate: number }[] | null> = {
  '1000pepeusdt': pepeFundingRaw as unknown as { ts: number; rate: number }[],
  dogeusdt: dogeFundingRaw as unknown as { ts: number; rate: number }[],
};

function toCandles(rows: RawCandle[]): Candle[] {
  return rows.map((r) => ({
    ts: r.ts,
    o: r.o,
    h: r.h,
    l: r.l,
    c: r.c,
    vol: r.vol,
    quoteVol: r.quoteVol,
    confirmed: true,
  }));
}

type RawMetric = Omit<EventMetrics, 'coin' | 'outcome'> & {
  coin: 'PEPE' | 'DOGE';
  outcome?: 'success' | 'failure' | 'normal' | null;
};

const campaignByEvent = new Map<string, { campaignId: string; label: string }>();
for (const c of CAMPAIGNS) {
  for (const id of c.eventIds) campaignByEvent.set(id, { campaignId: c.campaignId, label: c.label });
}

export interface HistoricalEvent extends EventMetrics {
  campaignId: string | null;
  campaignLabel: string | null;
  screenshot: string;
}

let eventsCache: HistoricalEvent[] | null = null;

/** 全部 21 个历史事件（含 campaign、截图路径）。 */
export function getHistoricalEvents(): HistoricalEvent[] {
  if (eventsCache) return eventsCache;
  const raw = eventMetricsRaw as unknown as RawMetric[];
  eventsCache = raw.map((m) => {
    const c = campaignByEvent.get(m.id) ?? null;
    return {
      ...m,
      outcome: m.outcome ?? null,
      campaignId: c?.campaignId ?? null,
      campaignLabel: c?.label ?? null,
      screenshot: `/screenshots/${m.id}.png`,
    };
  });
  return eventsCache;
}

export function getHistoricalEventById(id: string): HistoricalEvent | null {
  return getHistoricalEvents().find((e) => e.id === id) ?? null;
}

/** 历史 K 线快照（按币种，同路径查 config.SNAPSHOT_KEYS；ETHFI 无历史研究快照，返回空数组并由调用方按缺数据处理，禁编造）。 */
export function getSnapshotCandles(coin: 'PEPE' | 'DOGE' | 'BTC' | 'ETHFI'): Candle[] {
  const key = SNAPSHOT_KEYS[coin]?.candles;
  const raw = key ? (SNAPSHOT_CANDLES[key] ?? null) : null;
  if (!raw) return [];
  return toCandles(raw);
}

export function getSnapshotFunding(coin: 'PEPE' | 'DOGE' | 'ETHFI'): { ts: number; rate: number }[] {
  const key = SNAPSHOT_KEYS[coin]?.funding;
  const raw = key ? (SNAPSHOT_FUNDING[key] ?? null) : null;
  return raw ?? [];
}

/** 截取某事件窗口（含启动前 10 日）的 K 线，用于历史详情图表。 */
export function getEventCandles(event: EventMetrics, coin: 'PEPE' | 'DOGE' | 'ETHFI') {
  const candles = getSnapshotCandles(coin);
  const from = event.startTs - 10 * 86_400_000;
  const to = event.endTs;
  return candles.filter((c) => c.ts >= from && c.ts <= to);
}

export function getEventBtcCandles(event: EventMetrics) {
  const candles = getSnapshotCandles('BTC');
  const from = event.startTs - 10 * 86_400_000;
  const to = event.endTs;
  return candles.filter((c) => c.ts >= from && c.ts <= to);
}