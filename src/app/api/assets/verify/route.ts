import { NextResponse } from 'next/server';
import { applyVerifications, getSeedRegistry, registerCandidates } from '@/lib/registry';
import { getOkxSwapInstruments } from '@/lib/market-client';
import { verifyAssetById, defaultVerificationDeps, mapVerifyOutcomeToHttp } from '@/lib/asset-verification';
import { readVerifications, saveVerification } from '@/lib/server/asset-verification-repository';
import { tryOpenDb } from '@/lib/server/sqlite';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * 逐币核验并启用（服务端实时跑真实请求；任一失败 422 + 逐项原因）。
 * 全过 → 写入 asset_verification 记录并置为 enabled；seed 三币视为已启用，
 * ETHFI 保持无研究基线隔离（只进实时观察层，研究指标仍未知/缺失）。
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }
  const id = typeof (body as { id?: unknown } | null)?.id === 'string' ? ((body as { id: string }).id).trim() : '';
  if (!id) {
    return NextResponse.json({ ok: false, error: '缺少标的 id' }, { status: 400 });
  }

  try {
    // 解析标的：seed + OKX 公开永续候选（未知 id 由 verifyAssetById 返回可解释失败）。
    const seed = getSeedRegistry();
    const instruments = await getOkxSwapInstruments();
    const registered = instruments.ok ? registerCandidates(instruments.data, seed) : seed;
    const db = tryOpenDb();
    const registry = applyVerifications(registered, db ? readVerifications(db) : []);

    const { asset, outcome } = await verifyAssetById(id, registry, defaultVerificationDeps);
    const mapped = mapVerifyOutcomeToHttp(outcome, asset !== null, db === null);
    if (mapped.status !== 200 || !asset || !db) {
      return NextResponse.json(mapped.body, { status: mapped.status });
    }

    const record = {
      assetId: asset.id,
      instrument: asset.instId,
      ok: true as const,
      checks: outcome.checks,
      verifiedAt: Date.now(),
      by: 'api',
    };
    saveVerification(db, record);
    return NextResponse.json({ ...mapped.body, verifiedAt: record.verifiedAt });
  } catch (err) {
    return NextResponse.json(
      { ok: false, id, error: `核验失败：${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
