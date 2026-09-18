-- 0001_init.sql：观察盘配置首版结构（watch_layout + schema_migrations）。
-- 已发布迁移不回改；后续结构变更使用新迁移编号。

CREATE TABLE IF NOT EXISTS watch_layout (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  tier           INTEGER NOT NULL CHECK (tier IN (4, 6, 9)),
  slots_json     TEXT NOT NULL,
  favorites_json TEXT NOT NULL,
  updated_at     INTEGER NOT NULL
);
