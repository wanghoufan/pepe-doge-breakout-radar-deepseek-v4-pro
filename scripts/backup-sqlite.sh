#!/usr/bin/env bash
#
# backup-sqlite.sh —— SQLite 主库备份与隔离恢复验证（遵守 docs/sop/sqlite.md §11/§12）
#
# 用途：
#   1) 备份：用 SQLite 自身备份能力（.backup，在线一致快照）导出主库，
#      时间戳命名，支持 daily / pre-deploy（部署或 Migration 前）两类目录。
#   2) 验证：把备份复制到隔离临时目录，做 integrity_check / foreign_key_check /
#      schema version / 关键业务读取，全部通过才算备份可用。
#
# 用法：
#   scripts/backup-sqlite.sh backup [--kind daily|pre-deploy] [--db PATH] [--out DIR]
#   scripts/backup-sqlite.sh verify <backup.db>
#   scripts/backup-sqlite.sh --help
#
# 配置（环境变量优先，均无硬编码宿主机绝对路径）：
#   SQLITE_DB_PATH      主库路径；默认 <repo>/var/dev.db（开发库，已 Git 排除）
#   SQLITE_BACKUP_DIR   备份根目录；默认 <repo>/var/backups/sqlite
#                       生产建议 DockerBackups/<project_slug>/sqlite/
#   PROJECT_SLUG        项目标识；默认 pepe-doge-breakout-radar
#
# 正式部署 / Migration 前：
#   SQLITE_DB_PATH=/app/data/db/pepe-doge-breakout-radar.db \
#   SQLITE_BACKUP_DIR=/Users/zzymima0000/DockerBackups/pepe-doge-breakout-radar/sqlite \
#   scripts/backup-sqlite.sh backup --kind pre-deploy
#
# 隔离恢复标准流程（docs/sop/sqlite.md §12，人工执行、禁止直接覆盖生产）：
#   选择备份 → 复制到隔离目录（本脚本 verify 自动隔离到 mktemp）→
#   integrity_check → foreign_key_check → 检查 schema version → 检查关键表行数 →
#   执行关键业务读取 → 确认无误 → 用户批准 → 才允许替换生产数据库。
#   恢复替换本身不在此脚本内自动执行。
#
# 最低检查（脚本 verify 子命令逐项执行）：
#   PRAGMA integrity_check;      -- 期望 ok
#   PRAGMA foreign_key_check;    -- 期望空
#   SELECT version FROM schema_migrations;              -- schema version
#   SELECT tier, json_array_length(slots_json) ... FROM watch_layout;  -- 业务读取
#
set -Eeuo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROJECT_SLUG="${PROJECT_SLUG:-pepe-doge-breakout-radar}"
DB_PATH="${SQLITE_DB_PATH:-$REPO_ROOT/var/dev.db}"
BACKUP_ROOT="${SQLITE_BACKUP_DIR:-$REPO_ROOT/var/backups/sqlite}"

die() {
  echo "ERROR: $*" >&2
  exit 1
}

require_sqlite3() {
  command -v sqlite3 >/dev/null 2>&1 || die "未找到 sqlite3 CLI，请先安装（macOS 自带 /usr/bin/sqlite3）"
}

usage() {
  # 只输出文件头注释块（到 `set -Eeuo pipefail` 前的最后一行注释），去掉行首 "# "。
  sed -n '2,/^set -Eeuo pipefail$/p' "${BASH_SOURCE[0]}" | sed '$d' | sed 's/^# \{0,1\}//'
}

# 隔离恢复验证：只读打开副本，逐项检查并输出 PASS/FAIL。
verify_backup() {
  local file="$1"
  [[ -f "$file" ]] || die "备份文件不存在：$file"
  require_sqlite3

  local tmpbase="${TMPDIR:-/tmp}"
  tmpbase="${tmpbase%/}"
  local tmp
  tmp="$(mktemp -d "${tmpbase}/${PROJECT_SLUG}-restore-test.XXXXXX")"
  local copy="$tmp/$(basename "$file")"
  # 隔离：复制后再读，绝不在原库上跑检查。
  cp "$file" "$copy"

  local failed=0
  echo "== 隔离恢复验证：$file =="
  echo "隔离目录：$tmp"

  # 0) 可读性预检：非 SQLite 文件 / 头部损坏在此统一判 FAIL，避免后续逐一报错。
  if ! sqlite3 "$copy" 'PRAGMA schema_version;' >/dev/null 2>&1; then
    echo "[FAIL] 无法打开或解析数据库文件（非 SQLite 或已损坏）"
    rm -rf "$tmp"
    echo "== 验证结果：FAIL（禁止用该备份替换生产）==" >&2
    return 1
  fi

  # 1) integrity_check
  local integrity
  integrity="$(sqlite3 "$copy" 'PRAGMA integrity_check;')"
  if [[ "$integrity" == "ok" ]]; then
    echo "[PASS] integrity_check: ok"
  else
    echo "[FAIL] integrity_check: $integrity"
    failed=1
  fi

  # 2) foreign_key_check（无输出 = 无违规）
  local fk
  fk="$(sqlite3 "$copy" 'PRAGMA foreign_key_check;')"
  if [[ -z "$fk" ]]; then
    echo "[PASS] foreign_key_check: 无违规"
  else
    echo "[FAIL] foreign_key_check:"
    echo "$fk"
    failed=1
  fi

  # 3) schema version（迁移账本）
  local has_migrations
  has_migrations="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations';")"
  if [[ -n "$has_migrations" ]]; then
    local versions
    versions="$(sqlite3 "$copy" 'SELECT version FROM schema_migrations ORDER BY version;' | paste -sd ',' -)"
    echo "[PASS] schema version: ${versions:-（空）}"
  else
    echo "[FAIL] 缺少 schema_migrations 表，无法确认 schema version"
    failed=1
  fi

  # 4) 关键业务读取（watch_layout 单行配置：tier + slots JSON 合法性）
  local has_layout
  has_layout="$(sqlite3 "$copy" "SELECT name FROM sqlite_master WHERE type='table' AND name='watch_layout';")"
  if [[ -z "$has_layout" ]]; then
    echo "[FAIL] 缺少 watch_layout 表"
    failed=1
  else
    local row_count
    row_count="$(sqlite3 "$copy" 'SELECT COUNT(*) FROM watch_layout;')"
    if [[ "$row_count" == "0" ]]; then
      echo "[PASS] watch_layout: 0 行（首次访问默认布局，合法）"
    else
      local readout
      readout="$(sqlite3 "$copy" "SELECT 'tier=' || tier || ' schema=' || schema_version || ' slots=' || json_array_length(slots_json) || ' json_valid=' || json_valid(slots_json) || ' favorites=' || json_array_length(favorites_json) FROM watch_layout WHERE id = 1;")"
      if [[ -n "$readout" && "$readout" == *"json_valid=1"* ]]; then
        echo "[PASS] watch_layout 业务读取: $readout"
      else
        echo "[FAIL] watch_layout 业务读取异常: ${readout:-无 id=1 行}"
        failed=1
      fi
    fi
  fi

  rm -rf "$tmp"

  if [[ "$failed" -eq 0 ]]; then
    echo "== 验证结果：PASS（备份可用；替换生产前仍需用户批准）=="
    return 0
  fi
  echo "== 验证结果：FAIL（禁止用该备份替换生产）==" >&2
  return 1
}

# 备份主库，然后对产物跑一次隔离恢复验证。
do_backup() {
  local kind="daily"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --kind) kind="${2:-}"; shift 2 ;;
      --db) DB_PATH="${2:-}"; shift 2 ;;
      --out) BACKUP_ROOT="${2:-}"; shift 2 ;;
      -h|--help) usage; exit 0 ;;
      *) die "未知参数：${1}（用 --help 查看用法）" ;;
    esac
  done
  case "$kind" in
    daily|pre-deploy) ;;
    *) die "--kind 只支持 daily 或 pre-deploy，收到：$kind" ;;
  esac

  [[ -f "$DB_PATH" ]] || die "主库不存在：${DB_PATH}（用 SQLITE_DB_PATH 指定）"
  require_sqlite3

  local dir="$BACKUP_ROOT/$kind"
  mkdir -p "$dir"
  local ts
  ts="$(date +%Y-%m-%d_%H%M%S)"
  local dest="$dir/${ts}_${PROJECT_SLUG}.db"
  [[ -e "$dest" ]] && die "备份目标已存在（同一秒重复执行？）：$dest"

  # SQLite 在线备份 API：运行中写入也安全，禁止直接 cp 正在写的 db。
  sqlite3 "$DB_PATH" ".timeout 5000" ".backup '$dest'"
  [[ -s "$dest" ]] || die "备份产物为空：$dest"

  echo "备份完成（${kind}）：$dest"
  verify_backup "$dest" || die "备份已生成但验证未通过：$dest"
}

main() {
  local cmd="${1:-backup}"
  case "$cmd" in
    backup) shift; do_backup "$@" ;;
    verify) shift; [[ $# -eq 1 ]] || die "用法：$SCRIPT_NAME verify <backup.db>"; verify_backup "$1" ;;
    -h|--help|help) usage ;;
    *) die "未知子命令：${cmd}（用 --help 查看用法）" ;;
  esac
}

main "$@"
