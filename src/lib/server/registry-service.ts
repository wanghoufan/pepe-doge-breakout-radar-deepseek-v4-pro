/**
 * 服务端注册表：seed（PEPE/DOGE/ETHFI + BTC 参照）＋ SQLite 已持久化核验记录。
 *
 * 纯注册表（registry.ts）不触 I/O；本模块负责把 `asset_verification` 记录合并进来，
 * 使已核验启用的标的在重启后、以及 OKX 目录暂不可用时依然保持 enabled。
 * 不发起任何网络请求（候选目录合并仍由 API 层按需完成）。
 */
import type { DatabaseSync } from 'node:sqlite';
import { applyVerifications, getSeedRegistry, type RegistryAsset } from '../registry';
import { tryOpenDb } from './sqlite';
import { readVerifications } from './asset-verification-repository';

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
