/**
 * 观察盘布局与收藏（纯模块，客户端/服务端共用；无 I/O）。
 *
 * 语义（PRODUCT_PLAN V0.2 冻结）：
 * - 档位即布局：仅 4 / 6 / 9 三档，卡槽数 = 档位；
 * - 一币一卡：同一标的不得占用多个卡槽（重复项保留首个，其余置空）；
 * - 确定性补位：扩档时按「收藏优先、注册表稳定顺序次之」补入尚未占用的已启用标的；
 * - 缩档：保留前 N 个卡槽（被移除卡槽的标的不显示，收藏不变）；
 * - 停用 / 非法标的：从卡槽安全清除（收藏可保留但选择器不再展示）。
 */
import { getEnabledAssets, type RegistryAsset } from './registry';

export type LayoutTier = 4 | 6 | 9;
export const LAYOUT_TIERS: readonly LayoutTier[] = [4, 6, 9];
export const DEFAULT_LAYOUT_TIER: LayoutTier = 4;
export const LAYOUT_SCHEMA_VERSION = 1;

export interface WatchLayout {
  schemaVersion: number;
  tier: LayoutTier;
  /** 有序卡槽；长度 = tier；null = 空槽。 */
  slots: (string | null)[];
  /** 收藏标的 id（顺序即收藏顺序，用于补位优先级）。 */
  favorites: string[];
  updatedAt: number | null;
}

export function isLayoutTier(v: unknown): v is LayoutTier {
  return v === 4 || v === 6 || v === 9;
}

export function defaultLayout(): WatchLayout {
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    tier: DEFAULT_LAYOUT_TIER,
    slots: new Array(DEFAULT_LAYOUT_TIER).fill(null),
    favorites: [],
    updatedAt: null,
  };
}

/** 目标卡槽数 = 档位。 */
export function slotCount(tier: LayoutTier): number {
  return tier;
}

/**
 * 把任意输入规范成合法布局（幂等）：
 * - tier 非法 → 默认 4；
 * - slots 截断/补齐到 tier；
 * - slots 去重（一币一卡），非字符串/空串 → null；
 * - 未在 registry 中的标的 / 非 enabled → 清除；
 * - favorites 去重并仅保留 enabled。
 */
export function normalizeLayout(
  input: Partial<WatchLayout> | null | undefined,
  registry: RegistryAsset[] = getEnabledAssets(),
): WatchLayout {
  const enabled = new Set(getEnabledAssets(registry).map((a) => a.id));
  const tier: LayoutTier = isLayoutTier(input?.tier) ? (input!.tier as LayoutTier) : DEFAULT_LAYOUT_TIER;
  const rawSlots = Array.isArray(input?.slots) ? input!.slots : [];
  const slots: (string | null)[] = new Array(slotCount(tier)).fill(null);
  const used = new Set<string>();
  for (let i = 0; i < slotCount(tier); i += 1) {
    const id = rawSlots[i];
    if (typeof id !== 'string' || !id || !enabled.has(id) || used.has(id)) continue;
    slots[i] = id;
    used.add(id);
  }
  const favorites: string[] = [];
  const seenFav = new Set<string>();
  for (const id of Array.isArray(input?.favorites) ? input!.favorites : []) {
    if (typeof id !== 'string' || !id || !enabled.has(id) || seenFav.has(id)) continue;
    favorites.push(id);
    seenFav.add(id);
  }
  return {
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    tier,
    slots,
    favorites,
    updatedAt: typeof input?.updatedAt === 'number' ? input!.updatedAt : null,
  };
}

/**
 * 确定性补位：把空槽按「收藏优先、注册表稳定顺序次之」填入尚未占用的已启用标的。
 * 不改动已有卡槽（不串改），不生成重复卡；标的不足则保留空槽。
 */
export function fillSlots(layout: WatchLayout, registry: RegistryAsset[] = getEnabledAssets()): WatchLayout {
  const enabled = getEnabledAssets(registry);
  const enabledIds = new Set(enabled.map((a) => a.id));
  const used = new Set(layout.slots.filter((s): s is string => !!s && enabledIds.has(s)));
  const order: string[] = [];
  for (const id of layout.favorites) if (enabledIds.has(id) && !used.has(id)) order.push(id);
  for (const a of enabled) if (!used.has(a.id) && !order.includes(a.id)) order.push(a.id);

  const slots = layout.slots.map((s) => (s && enabledIds.has(s) ? s : null));
  let qi = 0;
  // 补位从第一个空槽起（保持既有卡槽位置不变）。
  for (let i = 0; i < slots.length && qi < order.length; i += 1) {
    if (slots[i] == null) {
      slots[i] = order[qi];
      qi += 1;
    }
  }
  return { ...layout, slots };
}

/** 切换档位：缩档保留前 N 槽，扩档先补位；收藏不变。 */
export function withTier(
  layout: WatchLayout,
  tier: LayoutTier,
  registry: RegistryAsset[] = getEnabledAssets(),
): WatchLayout {
  const resized: WatchLayout = normalizeLayout({ ...layout, tier, slots: layout.slots }, registry);
  return fillSlots(resized, registry);
}

/** 把某卡槽绑定到某标的：单向更新该槽；已占用他槽的标的会被拒绝（一币一卡）。 */
export function assignSlot(
  layout: WatchLayout,
  slotIndex: number,
  assetId: string | null,
  registry: RegistryAsset[] = getEnabledAssets(),
): { layout: WatchLayout; error: string | null } {
  if (slotIndex < 0 || slotIndex >= layout.slots.length) {
    return { layout, error: '卡槽下标越界' };
  }
  if (assetId != null) {
    const enabled = getEnabledAssets(registry).some((a) => a.id === assetId);
    if (!enabled) return { layout, error: '标的未启用，不能放入卡槽' };
    const dupIndex = layout.slots.findIndex((s, i) => s === assetId && i !== slotIndex);
    if (dupIndex >= 0) return { layout, error: '该标的已被其他卡槽占用（一币一卡）' };
  }
  const slots = [...layout.slots];
  slots[slotIndex] = assetId;
  return { layout: { ...layout, slots }, error: null };
}

/** 收藏开关。 */
export function toggleFavorite(layout: WatchLayout, assetId: string, registry: RegistryAsset[] = getEnabledAssets()): WatchLayout {
  const enabled = getEnabledAssets(registry).some((a) => a.id === assetId);
  if (!enabled) return layout;
  const set = new Set(layout.favorites);
  if (set.has(assetId)) set.delete(assetId);
  else set.add(assetId);
  return { ...layout, favorites: [...set] };
}

export interface LayoutValidation {
  ok: boolean;
  errors: string[];
  value: WatchLayout;
}

/**
 * 校验并规范化服务端写入（PUT /api/config）。
 * 只接受显式字段；档位必须 4/6/9；slots 长度必须 = 档位且一币一卡；
 * 收藏与卡槽只允许 enabled 标的；禁止未知 schemaVersion。
 */
export function validateLayoutInput(
  input: unknown,
  registry: RegistryAsset[] = getEnabledAssets(),
): LayoutValidation {
  const errors: string[] = [];
  const obj = (input ?? {}) as Partial<WatchLayout>;
  if (obj.schemaVersion != null && obj.schemaVersion !== LAYOUT_SCHEMA_VERSION) {
    errors.push(`不支持的 schemaVersion=${String(obj.schemaVersion)}`);
  }
  if (!isLayoutTier(obj.tier)) {
    errors.push('档位必须是 4 / 6 / 9');
    return { ok: false, errors, value: defaultLayout() };
  }
  const enabled = new Set(getEnabledAssets(registry).map((a) => a.id));
  if (!Array.isArray(obj.slots) || obj.slots.length !== slotCount(obj.tier)) {
    errors.push(`slots 长度必须等于档位 ${obj.tier}`);
  }
  const slots = Array.isArray(obj.slots) ? obj.slots : [];
  const used = new Set<string>();
  slots.forEach((s, i) => {
    if (s == null) return;
    if (typeof s !== 'string' || !enabled.has(s)) {
      errors.push(`卡槽 ${i + 1} 引用了未启用标的：${String(s)}`);
      return;
    }
    if (used.has(s)) errors.push(`卡槽 ${i + 1} 与前面卡槽重复占用 ${s}（一币一卡）`);
    used.add(s);
  });
  const favorites = Array.isArray(obj.favorites) ? obj.favorites : [];
  favorites.forEach((fav) => {
    if (typeof fav !== 'string' || !enabled.has(fav)) errors.push(`收藏引用了未启用标的：${String(fav)}`);
  });

  const value = normalizeLayout(
    { tier: obj.tier, slots: slots as (string | null)[], favorites, updatedAt: null },
    registry,
  );
  return { ok: errors.length === 0, errors, value };
}
