/**
 * 服务端注册表：seed（PEPE/DOGE/ETHFI + BTC 参照）＋ SQLite 已持久化核验记录。
 *
 * 纯注册表（registry.ts）不触 I/O；本模块负责把 `asset_verification` 记录合并进来，
 * 使已核验启用的标的在重启后、以及 OKX 目录暂不可用时依然保持 enabled。
 * 不发起任何网络请求（候选目录合并仍由 API 层按需完成）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { applyVerifications, getSeedRegistry, registerCandidates, findAsset, findEnabledAsset, type RegistryAsset } from '../registry';
import { tryOpenDb } from './sqlite';
import { readVerifications, saveVerification } from './asset-verification-repository';
import { verifyAssetById, defaultVerificationDeps } from '../asset-verification';
import { getOkxSwapInstruments } from '../market-client';

export function getServerRegistry(db: DatabaseSync | null = tryOpenDb()): RegistryAsset[] {
  const seed = getSeedRegistry();
  if (!db) return seed;
  try {
    return applyVerifications(seed, readVerifications(db));
  } catch {
    // 读取失败不影响页面：降级为 seed（未核验候选保持不可启用）。
    return seed;
  }
}

/**
 * 详情页即时核验（JIT）：已启用直接返回；候选币拉取 OKX 公开目录后跑
 * 真实核验，通过则落库（best-effort）并返回 enabled 标的，失败/未知返回 null。
 * 解决 Vercel 多实例 /tmp 不共享：页面不依赖访问亲和性，每次按需核验。
 */
export async function resolveEnabledAssetJIT(id: string): Promise<RegistryAsset | null> {
  const upper = String(id ?? '').trim().toUpperCase();
  if (!upper) return null;
  const db = tryOpenDb();
  const serverReg = getServerRegistry(db);
  const hit = findEnabledAsset(upper, serverReg);
  if (hit) return hit;

  // 未启用：拉 OKX 公开目录找候选（目录不可用→ null，由调用方 404）。
  const dir = await getOkxSwapInstruments();
  if (!dir.ok) return null;
  const merged = registerCandidates(dir.data, serverReg);
  const candidate = findAsset(upper, merged);
  if (!candidate || candidate.status !== 'candidate') return null;

  const { asset, outcome } = await verifyAssetById(upper, merged, defaultVerificationDeps);
  if (!asset || !outcome.ok) return null;
  if (db) {
    try {
      saveVerification(db, {
        assetId: asset.id,
        instrument: asset.instId,
        ok: true,
        checks: outcome.checks,
        verifiedAt: Date.now(),
        by: 'jit-page',
      });
    } catch {
      // 落库失败不阻断本次渲染（下次访问重核验）。
    }
  }
  return { ...asset, status: 'enabled', verifiedAt: Date.now() };
}
