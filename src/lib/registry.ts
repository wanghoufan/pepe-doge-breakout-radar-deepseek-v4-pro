/**
 * 标的注册表（纯模块，无 I/O、无网络、无阈值逻辑）。
 *
 * 目的（PRODUCT_PLAN V0.2）：把「可发现」与「可启用」分层——
 * - candidate：来自 OKX 公开永续目录的候选记录，仅登记，不代表可用；
 * - verified：已完成逐币数据源核验，具备启用资格；
 * - enabled ：通过启用门，可进入选择器与信号卡；
 * - disabled：显式停用（下架 / 核验过期 / 人工停用）。
 *
 * 冻结红线：本模块只做状态与门控，不复制、不修改任何阈值/权重/状态机；
 * 候选记录不得触发实时信号计算；未核验的 candidate 一律不得 enabled。
 *
 * 标的来源：已核验的 PEPE/DOGE/ETHFI 由 config.ASSETS 派生（保持既有单一来源），
 * BTC 仅作环境参照（role=reference），不进入可选信号池。
 */
import { ASSETS } from './config';

export type AssetStatus = 'candidate' | 'verified' | 'enabled' | 'disabled';

/** reference = 环境参照（BTC），signal = 可进入观察盘的信号标的。 */
export type AssetRole = 'signal' | 'reference';

export interface RegistryAsset {
  id: string;
  instId: string;
  spotInstId: string;
  name: string;
  symbol: string;
  role: AssetRole;
  status: AssetStatus;
  hasHistoryBaseline: boolean;
  sortOrder: number;
  themecolor: string;
  /** 核验完成时间（ms）；未核验 / 候选为 null。 */
  verifiedAt: number | null;
  /** 核验证据摘要（逐币清单结论）；未核验为 null。 */
  evidence: string | null;
  /** 记录来源：seed = 代码内置已核验集合；okx = OKX 公开目录候选。 */
  source: 'seed' | 'okx';
}

export const ASSET_STATUS_META: Record<AssetStatus, { label: string; description: string }> = {
  candidate: { label: '候选', description: 'OKX 公开永续目录记录，未核验，不可启用' },
  verified: { label: '已核验', description: '逐币数据源核验通过，具备启用资格' },
  enabled: { label: '已启用', description: '通过启用门，可进入选择器与信号卡' },
  disabled: { label: '已停用', description: '显式停用，不在选择器与信号卡出现' },
};

/** 已核验并启用的信号标的（来源：config.ASSETS；ETHFI 与 PEPE/DOGE 同路径）。 */
const SEED_SIGNAL_IDS = ['PEPE', 'DOGE', 'ETHFI'] as const;
/** 环境参照标的（BTC），不进入可选信号池。 */
const SEED_REFERENCE_IDS = ['BTC'] as const;

const SEED_VERIFIED_AT = Date.parse('2026-09-18T00:00:00Z');

function seedAsset(id: string, role: AssetRole, status: AssetStatus): RegistryAsset {
  const meta = ASSETS[id];
  if (!meta) throw new Error(`registry: ASSETS 缺少标的 ${id}`);
  return {
    id,
    instId: meta.instId,
    spotInstId: meta.spotInstId,
    name: meta.name,
    symbol: meta.symbol,
    role,
    status,
    hasHistoryBaseline: meta.hasHistoryBaseline,
    sortOrder: meta.sortOrder,
    themecolor: meta.themecolor,
    verifiedAt: role === 'signal' ? SEED_VERIFIED_AT : null,
    evidence:
      role === 'signal'
        ? '内置核验：OKX-USDT 永续、4H K 线可拉取、资金费率可用（PEPE/DOGE/ETHFI 同路径）'
        : '环境参照标的，非观察盘信号标的',
    source: 'seed',
  };
}

/** 内置注册表（已核验的 PEPE/DOGE/ETHFI + BTC 参照）。每次返回新数组，调用方不得原地改。 */
export function getSeedRegistry(): RegistryAsset[] {
  return [
    ...SEED_SIGNAL_IDS.map((id) => seedAsset(id, 'signal', 'enabled')),
    ...SEED_REFERENCE_IDS.map((id) => seedAsset(id, 'reference', 'verified')),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 启用门：只有 verified 具备启用资格；candidate / disabled 一律拒绝。 */
export function canEnableStatus(status: AssetStatus): { ok: boolean; reason: string | null } {
  if (status === 'verified') return { ok: true, reason: null };
  if (status === 'enabled') return { ok: true, reason: '已启用（幂等）' };
  if (status === 'candidate') return { ok: false, reason: '候选标尚未完成逐币核验，不得启用' };
  return { ok: false, reason: '标的已停用，需重新核验后方可启用' };
}

export function canEnableAsset(asset: RegistryAsset): { ok: boolean; reason: string | null } {
  if (asset.role === 'reference') return { ok: false, reason: '环境参照标的不作为信号标的' };
  if (!asset.hasHistoryBaseline) {
    // ETHFI 等无基线标的允许启用（只进入实时观察层），但研究层保持未知/缺失。
    return canEnableStatus(asset.status);
  }
  return canEnableStatus(asset.status);
}

/** 仅 enabled 且 role=signal 的标的可进入选择器与信号卡。 */
export function getEnabledAssets(registry: RegistryAsset[] = getSeedRegistry()): RegistryAsset[] {
  return registry
    .filter((a) => a.role === 'signal' && a.status === 'enabled')
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 候选池（candidate，仅登记，不可选）。 */
export function getCandidateAssets(registry: RegistryAsset[] = getSeedRegistry()): RegistryAsset[] {
  return registry.filter((a) => a.status === 'candidate');
}

export function isEnabledAsset(id: string, registry: RegistryAsset[] = getSeedRegistry()): boolean {
  return getEnabledAssets(registry).some((a) => a.id === id);
}

export function findAsset(id: string, registry: RegistryAsset[] = getSeedRegistry()): RegistryAsset | null {
  return registry.find((a) => a.id === id) ?? null;
}

/**
 * 把 OKX 公开永续目录合并成候选记录（纯函数，幂等）。
 * - 已有标的（按 instId 匹配）保持原状态，不被目录覆盖（防止候选覆盖已核验/已启用）；
 * - 未知 instId 追加为 candidate（verifiedAt/evidence 为 null），绝不 enabled；
 * - 只接受永续（instId 以 -SWAP 结尾）。
 */
export function registerCandidates(
  instruments: { instId: string; symbol?: string; state?: string }[],
  registry: RegistryAsset[] = getSeedRegistry(),
): RegistryAsset[] {
  const byInst = new Map(registry.map((a) => [a.instId, a]));
  const next = [...registry];
  for (const inst of instruments) {
    const instId = String(inst.instId ?? '');
    if (!instId.endsWith('-SWAP') || byInst.has(instId)) continue;
    const symbol = (inst.symbol ?? instId.replace('-USDT-SWAP', '')).toUpperCase();
    const record: RegistryAsset = {
      id: symbol,
      instId,
      spotInstId: `${symbol}-USDT`,
      name: symbol,
      symbol,
      role: 'signal',
      status: 'candidate',
      hasHistoryBaseline: false,
      sortOrder: 10_000 + next.length,
      themecolor: '#94A3B8',
      verifiedAt: null,
      evidence: null,
      source: 'okx',
    };
    byInst.set(instId, record);
    next.push(record);
  }
  return next;
}
