/**
 * SQLite 连接与 Migration（仅服务端；遵守 docs/sop/sqlite.md）。
 *
 * 冻结约定：
 * - project_slug = pepe-doge-breakout-radar，一个项目一个主库；
 * - 运行时路径由 SQLITE_DB_PATH 注入，业务代码不写死宿主机绝对路径；
 *   未注入时开发默认 <cwd>/var/dev.db（已 Git 排除）；
 * - Migration 文件在 db/migrations/（进入 Git），真实 .db 不进入 Git；
 * - 连接评估并启用 foreign_keys=ON、journal_mode=WAL、busy_timeout=5000；
 * - Migration 失败不得继续写业务数据（抛错，由调用方安全回退默认配置）。
 *
 * 生产宿主机路径（部署时由环境变量注入，不在代码内出现绝对路径）：
 *   DockerData/pepe-doge-breakout-radar/db/pepe-doge-breakout-radar.db
 *   容器内建议 /app/data/db/pepe-doge-breakout-radar.db（bind mount）。
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const PROJECT_SLUG = 'pepe-doge-breakout-radar';

/** 运行时数据库路径：优先环境变量，否则开发默认 var/dev.db。 */
export function getDbPath(): string {
  const fromEnv = process.env.SQLITE_DB_PATH;
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(process.cwd(), 'var', 'dev.db');
}

/** Migration 目录（可由 SQLITE_MIGRATIONS_DIR 覆盖，便于隔离测试）。 */
function getMigrationsDir(): string {
  const fromEnv = process.env.SQLITE_MIGRATIONS_DIR;
  if (fromEnv && fromEnv.trim()) return resolve(fromEnv.trim());
  return join(process.cwd(), 'db', 'migrations');
}

/** 打开数据库并应用 pragma 与迁移。路径目录不存在则创建。 */
export function openDatabaseAt(dbPath: string): DatabaseSync {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  runMigrations(db, getMigrationsDir());
  return db;
}

/**
 * 迁移执行器：按文件名升序应用 db/migrations/*.sql，未应用的才执行。
 * 版本记录在 schema_migrations；单文件在事务内执行，失败整体回滚并抛错。
 */
export function runMigrations(db: DatabaseSync, migrationsDir: string = getMigrationsDir()): string[] {
  db.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);',
  );
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all();
  const applied = new Set(appliedRows.map((r) => String(r.version)));

  if (!existsSync(migrationsDir)) return [];
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const newlyApplied: string[] = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, Date.now());
      db.exec('COMMIT');
      newlyApplied.push(file);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`SQLite migration 失败（${file}）：${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return newlyApplied;
}

let singleton: DatabaseSync | null = null;

/** 进程内单例（一个项目一个主库；测试用 openDatabaseAt 走隔离临时库）。 */
export function getDb(): DatabaseSync {
  if (!singleton) singleton = openDatabaseAt(getDbPath());
  return singleton;
}

/** 仅测试：关闭单例，避免跨用例串库。 */
export function closeDbForTests(): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      /* ignore */
    }
    singleton = null;
  }
}
