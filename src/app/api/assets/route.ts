import { NextResponse } from 'next/server';
import { getSeedRegistry, getEnabledAssets, registerCandidates, getCandidateAssets, ASSET_STATUS_META } from '@/lib/registry';
import { getOkxSwapInstruments } from '@/lib/market-client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/** 候选池只登记不启用：仅返回 OKX 公开永续目录计数与样例，不触发实时信号。 */
const CANDIDATE_SAMPLE = 12;

export async function GET() {
  const seed = getSeedRegistry();
  const instruments = await getOkxSwapInstruments();
  const registry = instruments.ok ? registerCandidates(instruments.data, seed) : seed;
  const candidates = getCandidateAssets(registry);
  const enabled = getEnabledAssets(registry);
  const reference = registry.filter((a) => a.role === 'reference');

  return NextResponse.json({
    ok: true,
    candidates: {
      status: instruments.ok ? 'live' : 'unavailable',
      total: candidates.length,
      sample: candidates.slice(0, CANDIDATE_SAMPLE).map((c) => c.instId),
      error: instruments.ok ? null : `OKX 永续目录不可用：${instruments.diag.errorDetail ?? instruments.error}`,
      note: '候选记录来自 OKX 公开永续目录，仅登记，未核验前不得启用。',
    },
    enabled: enabled.map((a) => ({
      id: a.id,
      name: a.name,
      symbol: a.symbol,
      instId: a.instId,
      status: a.status,
      statusLabel: ASSET_STATUS_META[a.status].label,
      hasHistoryBaseline: a.hasHistoryBaseline,
      themecolor: a.themecolor,
    })),
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
