import { NextResponse } from 'next/server';
import {
  applyVerifications,
  getSeedRegistry,
  getEnabledAssets,
  registerCandidates,
  ASSET_STATUS_META,
  type RegistryAsset,
} from '@/lib/registry';
import { getOkxSwapInstruments } from '@/lib/market-client';
import { readVerifications } from '@/lib/server/asset-verification-repository';
import { tryOpenDb } from '@/lib/server/sqlite';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** 候选池只登记不启用：样例只给计数与少量 instId，完整目录在 items（带核验/启用状态）。 */
const CANDIDATE_SAMPLE = 12;

/** 注册表标的 → API 视图（带上 verified/enabled 状态，供选择器区分可选与待核验）。 */
function toAssetView(a: RegistryAsset) {
  return {
    id: a.id,
    name: a.name,
    symbol: a.symbol,
    instId: a.instId,
    status: a.status,
    statusLabel: ASSET_STATUS_META[a.status].label,
    verified: a.status === 'verified' || a.status === 'enabled',
    enabled: a.status === 'enabled',
    verifiedAt: a.verifiedAt,
    evidence: a.evidence,
    hasHistoryBaseline: a.hasHistoryBaseline,
    themecolor: a.themecolor,
  };
}

export async function GET() {
  const seed = getSeedRegistry();
  const instruments = await getOkxSwapInstruments();
  const registered = instruments.ok ? registerCandidates(instruments.data, seed) : seed;
  // 已持久化核验记录 → 已核验标的保持 enabled（目录暂不可用时也可再水化）。
  const db = tryOpenDb();
  const records = db ? readVerifications(db) : [];
  const registry = applyVerifications(registered, records);

  const enabled = getEnabledAssets(registry);
  const reference = registry.filter((a) => a.role === 'reference');
  const signalAssets = registry.filter((a) => a.role === 'signal');
  const candidateCount = signalAssets.filter((a) => a.status === 'candidate').length;

  return NextResponse.json({
    ok: true,
    candidates: {
      status: instruments.ok ? 'live' : 'unavailable',
      total: signalAssets.length,
      candidateCount,
      enabledCount: enabled.length,
      sample: signalAssets
        .filter((a) => a.status === 'candidate')
        .slice(0, CANDIDATE_SAMPLE)
        .map((c) => c.instId),
      error: instruments.ok ? null : `OKX 永续目录不可用：${instruments.diag.errorDetail ?? instruments.error}`,
      note: '候选记录来自 OKX 公开永续目录；核验通过后方可启用。',
      // 完整信号标的目录（含已启用），每项带 verified/enabled 状态。
      items: signalAssets.map(toAssetView),
    },
    enabled: enabled.map(toAssetView),
    reference: reference.map((a) => ({
      id: a.id,
      name: a.name,
      symbol: a.symbol,
      instId: a.instId,
      status: a.status,
      role: a.role,
    })),
  });
}
