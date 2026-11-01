/**
 * ucup-edu-lib :: scripts/import-sqlite-to-pg.js
 *
 * Guard + validasi source jalan tanpa PostgreSQL. Test import memakai server
 * PostgreSQL LOKAL SUNGGUHAN (bukan stub), hanya kalau IMPORT_TEST_PG_ADMIN_URL
 * di-set, contoh (container sekali pakai, port hanya di loopback):
 *   docker run -d --rm --name edulib-import-test -e POSTGRES_PASSWORD=<local> \
 *     -p 127.0.0.1:55432:5432 postgres:17-alpine
 *   IMPORT_TEST_PG_ADMIN_URL=postgres://postgres:<local>@127.0.0.1:55432/postgres npm test
 * Tiap test membuat database `edulib_imp_<n>_staging` baru lalu menghapusnya.
 * Data seluruhnya sintetis.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const knexFactory = require('knex');
const { TABLES, convert, main } = require('../scripts/import-sqlite-to-pg');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS = { directory: path.join(ROOT, 'database/migrations') };
const ADMIN_URL = process.env.IMPORT_TEST_PG_ADMIN_URL;
const PG_SKIP = ADMIN_URL ? false : 'NOT VERIFIED: set IMPORT_TEST_PG_ADMIN_URL ke PostgreSQL lokal sekali pakai';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-import-'));
const ROLE = 'edulib_imp_staging';
const ROLE_PASSWORD = crypto.randomBytes(16).toString('hex');
const HASH = (n) => `$2b$10$${String(n).padStart(53, 'x')}`; // bentuk bcrypt, bukan hash asli
const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

let admin;
let dbCounter = 0;
const created = [];
test.after(async () => {
  if (admin) {
    for (const db of created) await admin.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [db]);
    await admin.raw('DROP ROLE IF EXISTS ??', [ROLE]);
    await admin.destroy();
  }
  fs.rmSync(temp, { recursive: true, force: true });
});

const sqlite = (filename) => knexFactory({ client: 'sqlite3', connection: { filename }, useNullAsDefault: true });

/** Source SQLite sintetis: migrasi penuh + data representatif (ada celah id). */
async function makeSource(name, mutate = async () => {}) {
  const filename = path.join(temp, `${name}.db`);
  const db = sqlite(filename);
  // Satu per satu: insert multi-baris Knex di SQLite mengisi kolom yang tidak disebut dengan NULL.
  const put = async (table, rows) => { for (const r of rows) await db(table).insert(r); };
  try {
    await quiet(() => db.migrate.latest(MIGRATIONS));
    await put('users', [
      { id: 1, email: 'admin@example.test', password_hash: HASH(1), full_name: 'Admin Satu', role: 'admin', session_version: 2 },
      { id: 4, email: 'member@example.test', password_hash: HASH(4), full_name: 'Member Empat', role: 'member', created_at: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
    ]);
    await put('fields', [{ id: 1, slug: 'tech', name: 'Teknologi', is_active: true }, { id: 3, slug: 'art', name: 'Seni', is_active: false, sort_order: 2 }]);
    await put('sub_fields', [{ id: 2, field_id: 1, slug: 'web', name: 'Web' }, { id: 5, field_id: 3, slug: 'design', name: 'Desain', parent_id: 2 }]);
    await put('contents', [
      { id: 7, sub_field_id: 2, title: 'Buku A', is_featured: true, cover_url: 'https://cdn.example.test/a.jpg', tags: 'a,b', level: 1 },
      { id: 9, sub_field_id: null, title: 'Buku B', is_featured: false, updated_at: '2026-03-04T05:06:07.890Z' },
    ]);
    await db('notes').insert({ id: 3, user_id: 4, content_id: 7, page_number: 2, note_text: 'catatan ✓', updated_at: null });
    await db('reading_progress').insert({ id: 6, user_id: 4, content_id: 9, last_page: 12 });
    await db('user_progress').insert({ id: 2, user_id: 1, content_id: 7, last_page_read: 3, status: 'done' });
    await db('password_reset_tokens').insert({ id: 8, user_id: 4, token_hash: 'a'.repeat(64), expires_at: new Date(Date.UTC(2026, 10, 1)), used_at: null });
    // id terbesar yang pernah dipakai users = 10 (baris 5..10 sudah dihapus).
    await db('sqlite_sequence').where({ name: 'users' }).update({ seq: 10 });
    await mutate(db);
  } finally {
    await db.destroy();
  }
  return filename;
}

/** Database staging PostgreSQL baru yang sudah dimigrasi. */
async function freshTarget() {
  if (!admin) {
    admin = knexFactory({ client: 'pg', connection: ADMIN_URL, pool: { min: 0, max: 2 } });
    await admin.raw('DROP ROLE IF EXISTS ??', [ROLE]);
    await admin.raw(`CREATE ROLE ?? LOGIN PASSWORD '${ROLE_PASSWORD}'`, [ROLE]);
  }
  const database = `edulib_imp_${process.pid}_${++dbCounter}_staging`;
  await admin.raw('CREATE DATABASE ?? OWNER ??', [database, ROLE]);
  created.push(database);
  const url = new URL(ADMIN_URL);
  const env = {
    DB_CLIENT: 'pg', DB_HOST: url.hostname, DB_PORT: url.port || '5432',
    DB_DATABASE: database, DB_USER: ROLE, DB_PASSWORD: ROLE_PASSWORD,
  };
  const db = knexFactory({ client: 'pg', connection: { host: env.DB_HOST, port: env.DB_PORT, database, user: ROLE, password: ROLE_PASSWORD } });
  await quiet(() => db.migrate.latest(MIGRATIONS));
  return { env, db, apply: { ...env, CONFIRM_IMPORT_DB: database } };
}

const run = (source, env, apply = false) => quiet(() => main(['--source', source, ...(apply ? ['--apply'] : [])], env));
const counts = async (db) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, Number((await db(t).count('* as c').first()).c)])));
const seq = async (db, t) => (await db.raw(`select last_value::int as v, is_called from ${t}_id_seq`)).rows[0];

test('convert: booleans, timestamps, nulls, lengths, integers', () => {
  const ts = { type: 'timestamp with time zone', nullable: true };
  assert.equal(convert(1, { type: 'boolean' }), true);
  assert.equal(convert(0, { type: 'boolean' }), false);
  assert.throws(() => convert('1', { type: 'boolean' }), /0\/1/);
  assert.equal(convert(null, { type: 'text', nullable: true }), null);
  assert.throws(() => convert(null, { type: 'text', nullable: false }), /NOT NULL/);
  assert.equal(convert('2026-11-01 02:49:54', ts), '2026-11-01T02:49:54Z'); // CURRENT_TIMESTAMP SQLite = UTC
  assert.equal(convert('2026-11-01T09:49:54.123456+07:00', ts), '2026-11-01T09:49:54.123456+07:00');
  assert.equal(convert(Date.UTC(2026, 0, 2), ts), '2026-01-02T00:00:00.000Z');
  assert.throws(() => convert(1761965394, ts), /epoch milidetik/); // epoch detik ditolak, tidak ditebak
  assert.throws(() => convert('2026-11-01 24:00:00', ts), /tidak valid/);
  assert.equal(convert('é'.repeat(64), { type: 'character varying', maxLength: 64 }).length, 64);
  assert.throws(() => convert('a'.repeat(65), { type: 'character varying', maxLength: 64 }), /64 karakter/);
  assert.throws(() => convert(2 ** 31, { type: 'integer' }), /32-bit/);
  assert.throws(() => convert(Buffer.from('x'), { type: 'text' }), /blob/);
});

test('guards refuse production, missing confirmation, and WAL/open sources before any PG access', async () => {
  const source = await makeSource('guards');
  const env = { DB_CLIENT: 'pg', DB_HOST: '192.0.2.1', DB_DATABASE: 'edulib_staging', DB_USER: 'edulib_staging' };
  await assert.rejects(main(['--source', source], { ...env, DB_DATABASE: 'edulib' }), /bukan database staging/);
  await assert.rejects(main(['--source', source], { ...env, DB_USER: 'edulib_admin' }), /bukan role staging/);
  await assert.rejects(main(['--source', source, '--apply'], env), /CONFIRM_IMPORT_DB=edulib_staging/);
  await assert.rejects(main([], env), /--source/);

  const wal = await makeSource('wal', (db) => db.raw('PRAGMA journal_mode = WAL'));
  await assert.rejects(main(['--source', wal], env), /mode WAL/);
  fs.writeFileSync(`${source}-journal`, '');
  await assert.rejects(main(['--source', source], env), /-journal ada/);
  fs.rmSync(`${source}-journal`);

  // CLI: host tak terjangkau; kalau guard bocor, error-nya koneksi, bukan "Menolak".
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/import-sqlite-to-pg.js'), '--source', source, '--apply'], {
    cwd: temp, encoding: 'utf8', timeout: 20000,
    env: { PATH: process.env.PATH, ...env, DB_DATABASE: 'edulib', CONFIRM_IMPORT_DB: 'edulib' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Menolak: DB_DATABASE "edulib" bukan database staging/);
});

test('dry-run (default) validates without writing; source is never modified', { skip: PG_SKIP }, async () => {
  const source = await makeSource('dry');
  const before = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
  const { env, db } = await freshTarget();
  try {
    const res = await run(source, { ...env, CONFIRM_IMPORT_DB: env.DB_DATABASE });
    assert.equal(res.applied, false);
    assert.deepEqual(res.tables.find((t) => t.table === 'users'), { table: 'users', rows: 2, maxId: 4, restart: 11 });
    assert.ok(Object.values(await counts(db)).every((c) => c === 0));
    assert.deepEqual(await seq(db, 'users'), { v: 1, is_called: false });
  } finally {
    await db.destroy();
  }
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'), before);
  assert.deepEqual(fs.readdirSync(temp).filter((f) => f.startsWith('dry.db')), ['dry.db']);
});

test('apply imports every table with ids, hashes, booleans, timestamps, FKs; sequences cannot collide', { skip: PG_SKIP }, async () => {
  const source = await makeSource('apply');
  const { db, apply } = await freshTarget();
  try {
    const res = await run(source, apply, true);
    assert.equal(res.applied, true);
    assert.deepEqual(await counts(db), {
      users: 2, fields: 2, sub_fields: 2, contents: 2, content_paths: 0,
      notes: 1, reading_progress: 1, user_progress: 1, password_reset_tokens: 1,
    });
    const users = await db('users').orderBy('id');
    assert.deepEqual(users.map((u) => [u.id, u.email, u.password_hash, u.role, u.session_version]),
      [[1, 'admin@example.test', HASH(1), 'admin', 2], [4, 'member@example.test', HASH(4), 'member', 0]]);
    assert.equal(users[1].created_at.toISOString(), '2026-01-02T03:04:05.000Z'); // epoch ms dari SQLite
    assert.ok(users[0].created_at instanceof Date); // CURRENT_TIMESTAMP string SQLite
    assert.deepEqual((await db('fields').orderBy('id')).map((f) => [f.id, f.is_active, f.sort_order]), [[1, true, 0], [3, false, 2]]);
    const contents = await db('contents').orderBy('id');
    assert.deepEqual(contents.map((c) => [c.id, c.sub_field_id, c.is_featured]), [[7, 2, true], [9, null, false]]);
    assert.equal(contents[1].updated_at.toISOString(), '2026-03-04T05:06:07.890Z');
    assert.equal((await db('notes').first()).note_text, 'catatan ✓');
    const token = await db('password_reset_tokens').first();
    assert.deepEqual([token.id, token.user_id, token.used_at, token.expires_at.toISOString()], [8, 4, null, '2026-11-01T00:00:00.000Z']);
    assert.equal((await db('sub_fields').where({ id: 5 }).first()).parent_id, 2);
    assert.equal(await db.schema.hasTable('sqlite_sequence'), false);
    // knex_migrations target tetap milik PG (tidak disalin dari source).
    assert.equal(Number((await db('knex_migrations').count('* as c').first()).c), fs.readdirSync(MIGRATIONS.directory).length);

    // Sequence: users menghormati sqlite_sequence (10), tabel kosong mulai dari 1.
    assert.deepEqual(await seq(db, 'users'), { v: 11, is_called: false });
    const [{ id: newUser }] = await db('users').insert({ email: 'baru@example.test', password_hash: HASH(9), full_name: 'Baru' }).returning('id');
    assert.equal(newUser, 11);
    const [{ id: newPath }] = await db('content_paths').insert({ path_type: 'next' }).returning('id');
    assert.equal(newPath, 1);
    const [{ id: newNote }] = await db('notes').insert({ user_id: 1, content_id: 9, page_number: 1, note_text: 'x' }).returning('id');
    assert.equal(newNote, 4);

    // Import kedua: target sudah berisi -> ditolak, data tetap.
    await assert.rejects(run(source, apply, true), /target tidak kosong \(users=3/);
    assert.equal(Number((await db('users').count('* as c').first()).c), 3);
  } finally {
    await db.destroy();
  }
});

test('all-empty source: import succeeds, every sequence starts at 1', { skip: PG_SKIP }, async () => {
  const source = path.join(temp, 'empty.db');
  const s = sqlite(source);
  await quiet(() => s.migrate.latest(MIGRATIONS));
  await s.destroy();
  const { db, apply } = await freshTarget();
  try {
    const res = await run(source, apply, true);
    assert.ok(res.tables.every((t) => t.rows === 0 && t.restart === 1));
    for (const t of TABLES) assert.deepEqual(await seq(db, t), { v: 1, is_called: false });
    const [{ id }] = await db('fields').insert({ slug: 's', name: 'n' }).returning('id');
    assert.equal(id, 1);
  } finally {
    await db.destroy();
  }
});

test('failure mid-import rolls back every table and every sequence', { skip: PG_SKIP }, async () => {
  // Source tanpa unique index notes -> duplikat lolos di SQLite, ditolak PG saat insert notes
  // (setelah users..content_paths sudah ter-insert dan sequence-nya di-RESTART).
  const source = await makeSource('rollback', async (db) => {
    await db.raw('DROP INDEX notes_user_content_page_unique');
    await db('notes').insert({ id: 5, user_id: 4, content_id: 7, page_number: 2, note_text: 'duplikat' });
  });
  const { db, apply } = await freshTarget();
  try {
    await assert.rejects(run(source, apply, true), (err) => {
      assert.match(err.message, /Insert notes id 3\.\.5 gagal: 23505 notes_user_content_page_unique/);
      assert.doesNotMatch(err.message, /\$2b\$|example\.test/, 'error tidak boleh membocorkan data');
      return true;
    });
    assert.ok(Object.values(await counts(db)).every((c) => c === 0));
    for (const t of TABLES) assert.deepEqual(await seq(db, t), { v: 1, is_called: false }, t);
  } finally {
    await db.destroy();
  }
});

test('source changed during apply: checksum mismatch rolls back before commit; retry succeeds', { skip: PG_SKIP }, async () => {
  const source = await makeSource('mutated');
  const { db, apply } = await freshTarget();
  // Deterministik, tanpa timing: hash #1 = sebelum baca, hash #2 = di dalam
  // transaksi setelah insert+verify. Tepat sebelum hash #2 file benar-benar diubah.
  const realRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function patched(file, ...rest) {
    if (file === source && ++reads === 2) fs.appendFileSync(source, Buffer.alloc(16, 1));
    return realRead.call(this, file, ...rest);
  };
  try {
    try {
      await assert.rejects(run(source, apply, true), (err) => {
        assert.match(err.message, /file source berubah selama import.*di-rollback/);
        assert.doesNotMatch(err.message, /\$2b\$|example\.test|password/i, 'error tidak boleh membocorkan data');
        return true;
      });
    } finally {
      fs.readFileSync = realRead;
    }
    assert.equal(reads, 2, 'hash kedua harus dihitung di dalam transaksi apply');
    assert.ok(Object.values(await counts(db)).every((c) => c === 0));
    for (const t of TABLES) assert.deepEqual(await seq(db, t), { v: 1, is_called: false }, t);

    // Target tetap kosong -> import ulang dari snapshot utuh langsung lolos.
    const res = await run(await makeSource('mutated-retry'), apply, true);
    assert.equal(res.applied, true);
    assert.equal(Number((await db('users').count('* as c').first()).c), 2);
    assert.deepEqual(await seq(db, 'users'), { v: 11, is_called: false });
  } finally {
    await db.destroy();
  }
});

test('invalid source data fails fast before any write', { skip: PG_SKIP }, async () => {
  const cases = [
    ['fk', async (db) => db('notes').insert({ id: 20, user_id: 999, content_id: 7, page_number: 9, note_text: 'yatim' }),
      /foreign_key_check source menemukan 1 pelanggaran \(notes rowid=20 -> users\)/],
    ['dupid', async (db) => {
      // Tabel legacy: id bukan INTEGER PRIMARY KEY, jadi duplikat mungkin ada.
      await db.raw('DROP TABLE content_paths');
      await db.raw('CREATE TABLE content_paths (id integer, sub_field_id integer, from_content_id integer, to_content_id integer, path_type varchar(255))');
      await db('content_paths').insert([{ id: 1, path_type: 'a' }, { id: 1, path_type: 'b' }]);
    }, /content_paths id=1: duplikat id/],
    ['bool', async (db) => db('fields').where({ id: 1 }).update({ is_active: 2 }), /fields id=1 kolom is_active: boolean harus 0\/1/],
    ['ts', async (db) => db('users').where({ id: 1 }).update({ created_at: '2026-02-31 10:00:00' }), /users id=1 kolom created_at: timestamp tidak valid/],
    ['legacy', async (db) => {
      await db.raw('ALTER TABLE contents ADD COLUMN cover_image_url text');
      await db('contents').where({ id: 7 }).update({ cover_image_url: 'https://cdn.example.test/old.jpg' });
    }, /kolom legacy contents.cover_image_url berisi 1 baris/],
    ['pending', async (db) => db('knex_migrations').where({ name: '20260926000001_password_reset.js' }).del(), /migration source/],
  ];
  const { db, env } = await freshTarget();
  try {
    for (const [name, mutate, re] of cases) {
      const source = await makeSource(`bad-${name}`, mutate);
      await assert.rejects(run(source, { ...env, CONFIRM_IMPORT_DB: env.DB_DATABASE }, true), re, name);
    }
    assert.ok(Object.values(await counts(db)).every((c) => c === 0));
  } finally {
    await db.destroy();
  }

  // Kolom legacy yang KOSONG boleh dibuang (dry-run lolos).
  const legacyEmpty = await makeSource('legacy-empty', (s) => s.raw('ALTER TABLE contents ADD COLUMN cover_image_url text'));
  await run(legacyEmpty, env);
});

test('target must be fully migrated', { skip: PG_SKIP }, async () => {
  const source = await makeSource('unmigrated');
  const { db, env } = await freshTarget();
  try {
    await quiet(() => db.migrate.rollback(MIGRATIONS)); // tabel tetap (baseline down tidak drop), password_reset hilang
    await assert.rejects(run(source, env), /tabel target|migration target/);
  } finally {
    await db.destroy();
  }
});
