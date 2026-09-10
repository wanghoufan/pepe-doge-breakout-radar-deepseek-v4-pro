/**
 * P0 数据基建：WS + REST 幂等回补（§6-5 / §6-7 冻结去重语义）。
 *
 * - 去重键（WS 与 REST 回补共用同一语义；symbol_norm 只分析、唯一身份一律
 *   `exchange + instrument_registry_key + 原生事件标识`）：
 *   trade → exchange|key|trade:{tradeId}（source_event_id=tradeId）；
 *   OI → exchange|key|oi:{源ts}（source_event_id=null，源 ts 仅去重、禁冒充原生 ID）；
 *   funding → exchange|key|funding:{fundingTime}（source_event_id=null）；
 *   depth → exchange|key|depth:{sequence}（source_sequence 必带；有原生 updateId 才填 source_event_id）。
 * - 序列缺口检测（source_sequence gap）+ REST 回补（is_backfill=true、channel=rest-backfill、
 *   沿用原 snapshot_id）+ 按去重键幂等写入（禁重复记录）。
 * - 纯函数 + 内存去重表，无网络、无评分（Quant NONE）。
 */
import type { ResearchRecord } from './schema';

export type DedupKind = 'trade' | 'oi' | 'funding' | 'depth';

export interface DedupInput {
  kind: DedupKind;
  exchange: string;
  instrumentRegistryKey: string;
  /** trade: tradeId；OI: 源ts；funding: fundingTime；depth: sequence/updateId。 */
  nativeId: string | number;
  /** depth 有原生 updateId 时才填（否则 null）。 */
  updateId?: string | number | null;
}

export function buildDedupKey(i: DedupInput): string {
  const base = `${i.exchange}|${i.instrumentRegistryKey}`;
  switch (i.kind) {
    case 'trade':
      return `${base}|trade:${String(i.nativeId)}`;
    case 'oi':
      return `${base}|oi:${String(i.nativeId)}`;
    case 'funding':
      return `${base}|funding:${String(i.nativeId)}`;
    case 'depth':
      return `${base}|depth:${String(i.nativeId)}`;
  }
}

/** 内存幂等表：同 dedup_key 重复写入返回 duplicate（禁产生重复记录）。 */
export class DedupStore {
  private seen = new Set<string>();

  insert(dedupKey: string): 'inserted' | 'duplicate' {
    if (this.seen.has(dedupKey)) return 'duplicate';
    this.seen.add(dedupKey);
    return 'inserted';
  }

  has(dedupKey: string): boolean {
    return this.seen.has(dedupKey);
  }

  get size(): number {
    return this.seen.size;
  }
}

export interface SeqGap {
  gap: boolean;
  /** 缺失的序列号区间（prev+1 .. curr-1）；无缺口为空数组。 */
  missing: number[];
  duplicateOrReorder: boolean;
}

/** WS 序列缺口检测（depth sequence / WS seq；prev=null 首包不判缺口）。 */
export function detectSequenceGap(prevSeq: number | null, currSeq: number): SeqGap {
  if (prevSeq === null || !Number.isFinite(prevSeq)) return { gap: false, missing: [], duplicateOrReorder: false };
  if (currSeq <= prevSeq) return { gap: false, missing: [], duplicateOrReorder: true };
  if (currSeq === prevSeq + 1) return { gap: false, missing: [], duplicateOrReorder: false };
  const missing: number[] = [];
  for (let s = prevSeq + 1; s < currSeq; s += 1) missing.push(s);
  return { gap: true, missing, duplicateOrReorder: false };
}

export interface BatchResult {
  inserted: ResearchRecord[];
  duplicates: ResearchRecord[];
}

/**
 * 统一幂等写入（WS 与 REST 回补共用）：
 * - 回补记录（is_backfill=true）必须 channel=rest-backfill 且沿用原 snapshot_id
 *   （调用方组装，本函数只校验：违规者计入 duplicates 并附因，禁写入）。
 */
export function ingestBatch(store: DedupStore, batch: ResearchRecord[]): BatchResult {
  const inserted: ResearchRecord[] = [];
  const duplicates: ResearchRecord[] = [];
  for (const r of batch) {
    if (r.is_backfill && r.channel !== 'rest-backfill') {
      duplicates.push(r);
      continue;
    }
    const res = store.insert(r.dedup_key);
    if (res === 'duplicate') duplicates.push(r);
    else inserted.push(r);
  }
  return { inserted, duplicates };
}

/** REST 回补标记：沿用原 snapshot_id，置 is_backfill + channel=rest-backfill。 */
export function markBackfill(records: ResearchRecord[], snapshotId: string | null): ResearchRecord[] {
  return records.map((r) => ({ ...r, is_backfill: true, channel: 'rest-backfill' as const, snapshot_id: snapshotId }));
}
