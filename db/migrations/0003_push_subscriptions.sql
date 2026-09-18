-- 0003_push_subscriptions.sql：全局推送（Web Push）订阅表。
-- 已发布迁移不回改；后续结构变更使用新迁移编号。
-- 一行一订阅（endpoint 唯一）：endpoint 为浏览器 Push 服务的唯一地址，
-- keys(p256dh/auth) 为客户端公钥与认证密钥，created_at 为订阅建立毫秒时间戳。
-- 订阅数据属本地私有数据，真实 .db 已被 .gitignore 排除（不进入 Git）。

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
