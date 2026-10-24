/**
 * ucup-edu-lib :: Regression test index baseline schema (SQLite + PostgreSQL)
 *
 * Index panas di 20260923000002_baseline_schema.js dulu hanya dibuat untuk
 * SQLite (backtick mentah di dalam `if (isSqlite)`), sehingga instalasi
 * PostgreSQL tidak punya index sama sekali.
 *
 * - SQLite: migration dijalankan sungguhan pada DB sementara.
 * - PostgreSQL: tidak ada server PG di CI/lokal, jadi up()/down() dijalankan
 *   pada stub knex ber-dialect `pg`; SQL yang dikirim dikompilasi oleh
 *   compiler Knex `pg` asli (tanpa koneksi) lalu diperiksa.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Knex = require('knex');

const ROOT = path.resolve(__dirname, '..');
const baseline = require('../database/migrations/20260923000002_baseline_schema');

const EXPECTED = {
  contents_sub_field_level_idx: { table: 'contents', columns: ['sub_field_id', 'level'] },
  notes_user_idx: { table: 'notes', columns: ['user_id'] },
  reading_progress_user_idx: { table: 'reading_progress', columns: ['user_id'] },
};
const NAMES = Object.keys(EXPECTED);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-baseline-idx-'));
const dbFile = path.join(temp, 'baseline-idx.db');

execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: ROOT,
  env: { ...process.env, DB_CLIENT: 'sqlite3', DB_FILENAME: dbFile },
  stdio: 'pipe',
});

const db = Knex({ client: 'sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });

const sqliteIndexes = async () => {
  const rows = await db('sqlite_master').where({ type: 'index' }).whereIn('name', NAMES).select('name', 'tbl_name');
  const out = {};
  for (const r of rows) {
    const cols = await db.raw(`PRAGMA index_info(${db.raw('??', [r.name]).toQuery()})`);
    out[r.name] = { table: r.tbl_name, columns: cols.sort((a, b) => a.seqno - b.seqno).map((c) => c.name) };
  }
  return out;
};

// Stub knex ber-dialect pg: tabel dianggap sudah ada (DB existing), raw()
// direkam sebagai SQL hasil kompilasi dialect pg.
const pgRecorder = () => {
  const compiler = Knex({ client: 'pg' });
  const sql = [];
  const stub = {
    client: { config: { client: 'pg' } },
    fn: compiler.fn,
    schema: {
      hasTable: async () => true,
      createTable: async () => { throw new Error('createTable tidak boleh dipanggil'); },
    },
    raw: async (q, bindings) => { sql.push(compiler.raw(q, bindings).toQuery()); return { rows: [] }; },
  };
  return { stub, sql, destroy: () => compiler.destroy() };
};

test.after(async () => {
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('sqlite: migrate:latest creates the three baseline indexes on the right columns', async () => {
  assert.deepEqual(await sqliteIndexes(), EXPECTED);
});

test('sqlite: re-running baseline up() is idempotent and preserves data/constraints', async () => {
  await db('users').insert({ id: 1, email: 'idx@test.local', password_hash: 'x', full_name: 'Idx' });
  await db('contents').insert({ id: 1, title: 'Idx', level: 1 });
  await db('notes').insert({ user_id: 1, content_id: 1, page_number: 1, note_text: 'n' });
  await db('reading_progress').insert({ user_id: 1, content_id: 1, last_page: 3 });

  await baseline.up(db);
  await baseline.up(db);

  assert.deepEqual(await sqliteIndexes(), EXPECTED);
  assert.equal((await db('notes')).length, 1);
  assert.equal((await db('reading_progress').first()).last_page, 3);
  // Unique constraint bawaan tetap ada (tidak ikut ter-drop/rebuild).
  const uniques = await db('sqlite_master').where({ type: 'index' }).where('name', 'like', '%unique%').pluck('name');
  assert.ok(uniques.includes('notes_user_content_page_unique'));
});

test('sqlite: down() drops only the indexes, keeps tables and rows; up() restores them', async () => {
  await baseline.down(db);
  assert.deepEqual(await sqliteIndexes(), {});
  for (const t of ['contents', 'notes', 'reading_progress']) assert.ok(await db.schema.hasTable(t), t);
  assert.equal((await db('notes')).length, 1);

  await baseline.down(db); // idempoten
  await baseline.up(db);
  assert.deepEqual(await sqliteIndexes(), EXPECTED);
});

test('pg: up() issues idempotent, double-quoted CREATE INDEX for all three indexes', async () => {
  const { stub, sql, destroy } = pgRecorder();
  try {
    await baseline.up(stub);
    assert.deepEqual(sql, [
      'CREATE INDEX IF NOT EXISTS "contents_sub_field_level_idx" ON "contents" ("sub_field_id", "level")',
      'CREATE INDEX IF NOT EXISTS "notes_user_idx" ON "notes" ("user_id")',
      'CREATE INDEX IF NOT EXISTS "reading_progress_user_idx" ON "reading_progress" ("user_id")',
    ]);
    for (const q of sql) assert.ok(!q.includes('`'), `backtick bukan identifier valid di PostgreSQL: ${q}`);
  } finally {
    await destroy();
  }
});

test('pg: down() drops only the three indexes with IF EXISTS, never tables', async () => {
  const { stub, sql, destroy } = pgRecorder();
  try {
    await baseline.down(stub);
    assert.deepEqual(sql, [
      'DROP INDEX IF EXISTS "contents_sub_field_level_idx"',
      'DROP INDEX IF EXISTS "notes_user_idx"',
      'DROP INDEX IF EXISTS "reading_progress_user_idx"',
    ]);
    for (const q of sql) assert.ok(!/DROP\s+TABLE/i.test(q), q);
  } finally {
    await destroy();
  }
});
