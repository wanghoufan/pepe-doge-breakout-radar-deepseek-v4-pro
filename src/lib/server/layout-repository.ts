/**
 * 观察盘配置 Repository（仅服务端；浏览器不接触 .db，也不散落 SQL）。
 *
 * 集中读写 watch_layout 单行配置，负责：
 * - 读取 + 安全迁移：JSON 损坏 / schema version 不兼容 / 标的停用 → normalizeLayout
 *   清除非法项；无法解析则回退默认配置并给出原因（不阻塞页面）。
 * - 写入：先 validateLayoutInput（4/6/9、长度、一币一卡、enabled），再事务写入。
 *
 * 可注入 db（测试用隔离临时库）；默认走进程单例 getDb()。
 */
import type { DatabaseSync } from 'node:sqlite';
import { getDb } from './sqlite';
import {
  defaultLayout,
  normalizeLayout,
  validateLayoutInput,
  LAYOUT_SCHEMA_VERSION,
  type WatchLayout,
} from '../layout';
import { getEnabledAssets, type RegistryAsset } from '../registry';

export interface LayoutLoadResult {
  layout: WatchLayout;
  /** 非 null 表示发生了安全迁移 / 回退，值为人读原因。 */
  notice: string | null;
  /** 服务端是否已有持久化记录（false = 首次访问，客户端按默认布局补位后落盘）。 */
  persisted: boolean;
}

interface LayoutRow {
  schema_version: number;
  tier: number;
  slots_json: string;
  favorites_json: string;
  updated_at: number;
}

/** 读取配置：无记录用默认；损坏 / 过期 / 非法项安全迁移并可回退。 */
export function readLayout(
  db: DatabaseSync = getDb(),
  registry: RegistryAsset[] = getEnabledAssets(),
): LayoutLoadResult {
  let row: LayoutRow | undefined;
  try {
    row = db
      .prepare('SELECT schema_version, tier, slots_json, favorites_json, updated_at FROM watch_layout WHERE id = 1')
      .get() as LayoutRow | undefined;
  } catch (err) {
    return {
      layout: defaultLayout(),
      notice: `读取配置失败，已回退默认 4 卡：${err instanceof Error ? err.message : String(err)}`,
      persisted: false,
    };
  }
  if (!row) return { layout: defaultLayout(), notice: null, persisted: false };

  let rawSlots: unknown;
  let rawFavorites: unknown;
  try {
    rawSlots = JSON.parse(row.slots_json);
    rawFavorites = JSON.parse(row.favorites_json);
  } catch {
    return { layout: defaultLayout(), notice: '配置 JSON 损坏，已回退默认 4 卡（原因已记录）', persisted: true };
  }

  const noticeParts: string[] = [];
  if (row.schema_version !== LAYOUT_SCHEMA_VERSION) {
    noticeParts.push(`schema version ${row.schema_version} → ${LAYOUT_SCHEMA_VERSION} 安全迁移`);
  }

  const normalized = normalizeLayout(
    {
      tier: row.tier as WatchLayout['tier'],
      slots: rawSlots as (string | null)[],
      favorites: rawFavorites as string[],
      updatedAt: row.updated_at,
    },
    registry,
  );

  if (Array.isArray(rawSlots)) {
    const dropped = rawSlots.filter((s, i) => typeof s === 'string' && s && normalized.slots[i] !== s).length;
    if (dropped > 0) noticeParts.push(`已清除 ${dropped} 个失效/未启用卡槽绑定`);
  }

  return { layout: normalized, notice: noticeParts.length ? noticeParts.join('；') : null, persisted: true };
}

export interface WriteResult {
  ok: boolean;
  errors: string[];
  layout: WatchLayout;
}

/** 校验后事务写入（原子；非法输入不落盘）。 */
export function writeLayout(
  input: unknown,
  db: DatabaseSync = getDb(),
  registry: RegistryAsset[] = getEnabledAssets(),
): WriteResult {
  const validation = validateLayoutInput(input, registry);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors, layout: readLayout(db, registry).layout };
  }

  const layout = { ...validation.value, updatedAt: Date.now() };
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO watch_layout (id, schema_version, tier, slots_json, favorites_json, updated_at)
       VALUES (1, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         schema_version = excluded.schema_version,
         tier = excluded.tier,
         slots_json = excluded.slots_json,
         favorites_json = excluded.favorites_json,
         updated_at = excluded.updated_at`,
    ).run(
      LAYOUT_SCHEMA_VERSION,
      layout.tier,
      JSON.stringify(layout.slots),
      JSON.stringify(layout.favorites),
      layout.updatedAt,
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return { ok: false, errors: [`写入失败：${err instanceof Error ? err.message : String(err)}`], layout };
  }
  return { ok: true, errors: [], layout };
}

/** 清除配置（恢复默认 4 卡）。 */
export function resetLayout(
  db: DatabaseSync = getDb(),
  registry: RegistryAsset[] = getEnabledAssets(),
): WatchLayout {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM watch_layout WHERE id = 1').run();
    db.exec('COMMIT');
  } catch {
    db.exec('ROLLBACK');
  }
  return readLayout(db, registry).layout;
}
