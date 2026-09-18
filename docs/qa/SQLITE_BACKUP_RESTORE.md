# SQLite 备份与隔离恢复验证（backup-sqlite.sh）

> 对应规范：`docs/sop/sqlite.md` §11（备份规则）/ §12（恢复规则）。
> 脚本：`scripts/backup-sqlite.sh`（源码仓库本身，不写入生产数据库）。
> project_slug：`pepe-doge-breakout-radar`。
> 范围：本地 MVP 主库（`watch_layout` 单行配置）；Backlog 项「备份与恢复演练缺失」的接入。

## 1. 为什么需要

`docs/review/CODE_REVIEW.md` P1-非 blocking：本轮只有 Migration＋事务，无备份脚本与隔离恢复步骤。
本文件补齐 §11（每日备份 / 部署及 Migration 前额外备份）与 §12（恢复必须先在隔离环境验证）。

## 2. 配置（环境变量优先，无硬编码宿主机绝对路径）

| 变量 | 含义 | 默认值 |
|---|---|---|
| `SQLITE_DB_PATH` | 主库路径 | `<repo>/var/dev.db`（开发库，已 Git 排除） |
| `SQLITE_BACKUP_DIR` | 备份根目录 | `<repo>/var/backups/sqlite`（已 Git 排除） |
| `PROJECT_SLUG` | 项目标识（备份文件名用） | `pepe-doge-breakout-radar` |

生产建议（部署 / Migration 前，`--kind pre-deploy`）：

```bash
SQLITE_DB_PATH=/app/data/db/pepe-doge-breakout-radar.db \
SQLITE_BACKUP_DIR=/Users/zzymima0000/DockerBackups/pepe-doge-breakout-radar/sqlite \
scripts/backup-sqlite.sh backup --kind pre-deploy
```

## 3. 备份

```bash
scripts/backup-sqlite.sh backup [--kind daily|pre-deploy] [--db PATH] [--out DIR]
```

- 使用 SQLite 在线备份能力 `.backup`（运行中写入安全），禁止直接 `cp` 正在写的 `.db`。
- 时间戳命名：`<YYYY-MM-DD_HHMMSS>_<project_slug>.db`，落 `<BACKUP_ROOT>/<daily|pre-deploy>/`。
- 备份后立即对产物跑一次隔离恢复验证；验证不过则脚本非零退出。
- 目录约定（随规范）：`daily/`、`pre-deploy/`、`restore-tests/`；备份不进 Git。

## 4. 隔离恢复验证（§12）

```bash
scripts/backup-sqlite.sh verify <backup.db>
```

脚本先 `cp` 到 `mktemp -d` 隔离目录再只读打开，逐项检查并输出 PASS/FAIL：

1. 可读性预检（非 SQLite / 头部损坏 → FAIL）。
2. `PRAGMA integrity_check;` → 期望 `ok`。
3. `PRAGMA foreign_key_check;` → 期望无输出（无违规）。
4. schema version：`SELECT version FROM schema_migrations ORDER BY version;`。
5. 关键业务读取：`watch_layout` 单行配置的 `tier / schema_version / json_array_length(slots_json) / json_valid` 与收藏数。

**恢复标准流程（人工执行）**：选择备份 → 复制到隔离目录（`verify` 自动隔离）→ 上述 5 项检查 →
确认无误 → **用户批准** → 才允许替换生产数据库。替换动作不在脚本内自动执行；
禁止未验证就覆盖生产、禁止用开发库覆盖生产、禁止恢复时删除全部历史备份。

## 5. 沙箱备份演练记录（用临时测试库，未碰真实数据）

- 日期：2026-09-18；执行者：builder；环境：macOS，`sqlite3 3.51.0`。
- 临时库：`mktemp -d` 下 `drill.db`，按 `db/schema.sql` 建 `schema_migrations` + `watch_layout`，
  写入一行 6 卡配置（`slots=["PEPE","DOGE","ETHFI",null,null,null]`，`favorites=["PEPE"]`）。
- 命令：
  ```bash
  SQLITE_DB_PATH=<tmp>/drill.db SQLITE_BACKUP_DIR=<tmp>/backups \
    bash scripts/backup-sqlite.sh backup --kind pre-deploy
  ```
- 结果（原样）：
  ```text
  备份完成（pre-deploy）：<tmp>/backups/pre-deploy/2026-09-18_140525_pepe-doge-breakout-radar.db
  == 隔离恢复验证 ==
  [PASS] integrity_check: ok
  [PASS] foreign_key_check: 无违规
  [PASS] schema version: 0001_init.sql
  [PASS] watch_layout 业务读取: tier=6 schema=1 slots=6 json_valid=1 favorites=1
  == 验证结果：PASS（备份可用；替换生产前仍需用户批准）==
  ```
- 负向用例：`verify` 对非 SQLite 文件返回 `[FAIL] 无法打开或解析数据库文件` 且退出码非 0。
- 结论：`backup` / `verify` 两路径均按 §11/§12 工作；临时目录已清理，真实库未参与。

## 6. 遗留 / 边界

- 未接入定时任务（每日自动备份）与保留策略（轮转/异地副本）——上正式 Docker 部署前需补。
- Vercel 生产文件系统短暂（`/tmp`，跨部署不保证）：该脚本面向本地 / Docker 持久化库；
  Vercel 生产不适用，UI 已声明不保证跨部署保存。
- 自动替换生产库不在脚本范围；恢复替换始终人工 + 用户批准。
