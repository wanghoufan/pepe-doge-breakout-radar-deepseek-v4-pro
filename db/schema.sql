-- 观察盘配置 schema 快照（唯一来源；迁移目录 db/migrations/ 为准）。
-- project_slug = pepe-doge-breakout-radar
-- 单用户、单实例本地运行；一个项目一个 SQLite 主库。

PRAGMA foreign_keys = ON;

-- 迁移版本账本（Migration 治理，见 docs/sop/sqlite.md §7）。
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

-- 单行配置：布局档位 + 有序卡槽 + 收藏。
-- slots_json   : JSON 数组，长度 = tier，元素为 assetId 或 null。
-- favorites_json: JSON 数组，收藏的 assetId。
CREATE TABLE IF NOT EXISTS watch_layout (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  tier           INTEGER NOT NULL CHECK (tier IN (4, 6, 9)),
  slots_json     TEXT NOT NULL,
  favorites_json TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);
