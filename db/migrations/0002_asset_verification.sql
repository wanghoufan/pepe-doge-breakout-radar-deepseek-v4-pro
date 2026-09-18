-- 0002_asset_verification.sql：逐币核验记录（候选 → 已启用的可审计证据）。
-- 已发布迁移不回改；后续结构变更使用新迁移编号。
-- 一行一标的，仅在全过核验并启用时写入（由服务端 Repository 事务写入）。
-- checks_json 保存完整逐项核验结论（含值/来源/时间戳/成败），供审计与 UI 展示。

CREATE TABLE IF NOT EXISTS asset_verification (
  asset_id    TEXT PRIMARY KEY,
  instrument  TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  verified_at INTEGER NOT NULL,
  by          TEXT NOT NULL
);
