import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabaseAt } from './server/sqlite';
import { readLayout, writeLayout, resetLayout } from './server/layout-repository';
import { getSeedRegistry } from './registry';

const REG = getSeedRegistry();

function withTempDb<T>(fn: (db: ReturnType<typeof openDatabaseAt>, path: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'radar-sqlite-'));
  const path = join(dir, 'test.db');
  const db = openDatabaseAt(path);
  try {
    return fn(db, path);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test('SQLite：Migration 建立表且幂等', () => {
  withTempDb((db) => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => String(r.name));
    assert.ok(tables.includes('watch_layout'));
    assert.ok(tables.includes('schema_migrations'));
    const migrations = db.prepare('SELECT version FROM schema_migrations').all();
    assert.equal(migrations.length, 1);
    assert.equal(String(migrations[0].version), '0001_init.sql');
  });
});

test('SQLite：无记录时返回默认 4 卡且 persisted=false', () => {
  withTempDb((db) => {
    const { layout, persisted, notice } = readLayout(db, REG);
    assert.equal(persisted, false);
    assert.equal(notice, null);
    assert.equal(layout.tier, 4);
    assert.deepEqual(layout.slots, [null, null, null, null]);
  });
});

test('SQLite：写入合法布局后可读回，重启（重开库）持久化保留', () => {
  const dir = mkdtempSync(join(tmpdir(), 'radar-sqlite-'));
  const path = join(dir, 'persist.db');
  try {
    const db1 = openDatabaseAt(path);
    const res = writeLayout({ tier: 6, slots: ['PEPE', 'DOGE', 'ETHFI', null, null, null], favorites: ['ETHFI'] }, db1, REG);
    assert.equal(res.ok, true);
    db1.close();

    const db2 = openDatabaseAt(path);
    const { layout, persisted } = readLayout(db2, REG);
    db2.close();
    assert.equal(persisted, true);
    assert.equal(layout.tier, 6);
    assert.deepEqual(layout.slots, ['PEPE', 'DOGE', 'ETHFI', null, null, null]);
    assert.deepEqual(layout.favorites, ['ETHFI']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SQLite：非法写入被拒且不落盘', () => {
  withTempDb((db) => {
    const bad = writeLayout({ tier: 4, slots: ['PEPE', 'PEPE', null, null], favorites: [] }, db, REG);
    assert.equal(bad.ok, false);
    assert.ok(bad.errors.length > 0);
    const { persisted } = readLayout(db, REG);
    assert.equal(persisted, false);
  });
});

test('SQLite：JSON 损坏时回退默认 4 卡并给出原因', () => {
  withTempDb((db) => {
    writeLayout({ tier: 4, slots: ['PEPE', null, null, null], favorites: [] }, db, REG);
    db.prepare("UPDATE watch_layout SET slots_json='{broken' WHERE id=1").run();
    const { layout, notice } = readLayout(db, REG);
    assert.equal(layout.tier, 4);
    assert.deepEqual(layout.slots, [null, null, null, null]);
    assert.match(notice ?? '', /损坏/);
  });
});

test('SQLite：schema version 不兼容时安全迁移并记录原因', () => {
  withTempDb((db) => {
    writeLayout({ tier: 4, slots: ['PEPE', null, null, null], favorites: [] }, db, REG);
    db.prepare('UPDATE watch_layout SET schema_version=99 WHERE id=1').run();
    const { layout, notice } = readLayout(db, REG);
    assert.equal(layout.tier, 4);
    assert.deepEqual(layout.slots, ['PEPE', null, null, null]);
    assert.match(notice ?? '', /安全迁移/);
  });
});

test('SQLite：停用/未启用标的从卡槽清除并记录原因', () => {
  withTempDb((db) => {
    db.prepare(
      "INSERT INTO watch_layout (id, schema_version, tier, slots_json, favorites_json, updated_at) VALUES (1,1,4,'[\"PEPE\",\"FAKECOIN\",null,null]','[\"FAKECOIN\"]',1)",
    ).run();
    const { layout, notice } = readLayout(db, REG);
    assert.deepEqual(layout.slots, ['PEPE', null, null, null]);
    assert.deepEqual(layout.favorites, []);
    assert.match(notice ?? '', /清除/);
  });
});

test('SQLite：reset 恢复默认 4 卡', () => {
  withTempDb((db) => {
    writeLayout({ tier: 9, slots: ['PEPE', 'DOGE', 'ETHFI', null, null, null, null, null, null], favorites: [] }, db, REG);
    const layout = resetLayout(db, REG);
    assert.equal(layout.tier, 4);
    assert.deepEqual(layout.slots, [null, null, null, null]);
  });
});
