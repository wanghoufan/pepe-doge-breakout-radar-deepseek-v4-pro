/**
 * 逐币核验记录 Repository（仅服务端；浏览器不接触 .db，也不散落 SQL）。
 *
 * 一行一标的：asset_id / instrument / checks_json / verified_at / by。
 * 只保存全过核验的启用记录；读取时对损坏 JSON 做防御性降解（不抛错、不误启用）。
 */
import type { DatabaseSync } from 'node:sqlite';
import type { AssetVerificationRecord, VerificationCheck } from '../registry';

interface VerificationRow {
  asset_id: string;
  instrument: string;
  checks_json: string;
  verified_at: number;
  by: string;
}

function parseChecks(raw: string): { ok: boolean; checks: VerificationCheck[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, checks: [] };
  }
  const obj = (parsed ?? {}) as { ok?: unknown; checks?: unknown };
  const checks = Array.isArray(obj.checks)
    ? obj.checks.filter((c): c is VerificationCheck => {
        const v = c as Partial<VerificationCheck>;
        return typeof v?.key === 'string' && typeof v?.label === 'string' && typeof v?.ok === 'boolean' && typeof v?.detail === 'string';
      })
    : [];
  return { ok: obj.ok === true && checks.length > 0, checks };
}

/** 读取全部核验记录（损坏行跳过；ok 以持久化标记为准）。 */
export function readVerifications(db: DatabaseSync): AssetVerificationRecord[] {
  let rows: VerificationRow[];
  try {
    rows = db
      .prepare('SELECT asset_id, instrument, checks_json, verified_at, by FROM asset_verification')
      .all() as unknown as VerificationRow[];
  } catch {
    return [];
  }
  const out: AssetVerificationRecord[] = [];
  for (const row of rows) {
    const { ok, checks } = parseChecks(row.checks_json);
    out.push({
      assetId: String(row.asset_id),
      instrument: String(row.instrument),
      ok,
      checks,
      verifiedAt: Number(row.verified_at),
      by: String(row.by),
    });
  }
  return out;
}

export function getVerification(db: DatabaseSync, assetId: string): AssetVerificationRecord | null {
  return readVerifications(db).find((r) => r.assetId === assetId) ?? null;
}

/** 事务写入（幂等 upsert）：仅全过核验调用；失败抛错由 API 诚实回执。 */
export function saveVerification(db: DatabaseSync, record: AssetVerificationRecord): void {
  const checksJson = JSON.stringify({ ok: record.ok, checks: record.checks });
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO asset_verification (asset_id, instrument, checks_json, verified_at, by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(asset_id) DO UPDATE SET
         instrument = excluded.instrument,
         checks_json = excluded.checks_json,
         verified_at = excluded.verified_at,
         by = excluded.by`,
    ).run(record.assetId, record.instrument, checksJson, record.verifiedAt, record.by);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
