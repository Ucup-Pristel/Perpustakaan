/**
 * ucup-edu-lib :: Regression test kesiapan migrasi PostgreSQL (dialect pg)
 *
 * Tidak ada server PostgreSQL di CI/lokal. Seperti insert-ids.pg.test.js,
 * client Knex `pg` asli dipakai (compiler + processResponse), hanya koneksi
 * driver yang di-stub: INSERT tanpa RETURNING -> rows: [], dengan RETURNING
 * -> rows: [{ id }]. Tidak ada socket yang dibuka.
 *
 * - scripts/migrate-staging.js: tolak target non-staging sebelum koneksi,
 *   dan tolak kalau server melaporkan database/user berbeda.
 * - scripts/seed-db.js: ID hasil insert di-propagasi lewat `.returning('id')`,
 *   COUNT string dari pg ("3") tetap dianggap katalog berisi.
 * - scripts/create-admin.js: `.returning('id')` pada pg.
 * Perilaku terhadap server PG 17 sungguhan tetap BELUM terverifikasi di sini.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
Object.assign(process.env, {
  DB_CLIENT: 'pg', DB_HOST: '127.0.0.1', DB_DATABASE: 'edulib_staging', DB_USER: 'edulib_staging', NODE_ENV: 'test',
});

const PgClient = require('knex/lib/dialects/postgres');
const queries = [];
let nextId = 100;
let serverIdentity = { database: 'edulib_staging', user: 'edulib_staging' };
let catalogCount = '0';

PgClient.prototype.acquireConnection = async () => ({ __stub: true });
PgClient.prototype.releaseConnection = async () => {};
PgClient.prototype._query = async function _query(connection, obj) {
  const sql = obj.sql.toLowerCase();
  queries.push({ sql: obj.sql, bindings: obj.bindings });
  if (sql.startsWith('select current_database()')) {
    obj.response = { command: 'SELECT', rowCount: 1, rows: [serverIdentity] };
  } else if (sql.startsWith('select count(*)')) {
    obj.response = { command: 'SELECT', rowCount: 1, rows: [{ c: catalogCount }] };
  } else if (sql.startsWith('insert')) {
    const rows = /returning "id"/.test(sql) ? [{ id: nextId++ }] : [];
    obj.response = { command: 'INSERT', rowCount: 1, rows };
  } else {
    throw new Error(`Query tak terduga di stub pg: ${obj.sql}`);
  }
  return obj;
};

const { assertStagingTarget, main: migrateStaging } = require('../scripts/migrate-staging');
const { assertEmptyCatalog, seedSample } = require('../scripts/seed-db');

const STAGING = { DB_CLIENT: 'pg', DB_DATABASE: 'edulib_staging', DB_USER: 'edulib_staging' };

test('assertStagingTarget rejects production and non-pg targets', () => {
  const reject = (env, cmd, re) => assert.throws(() => assertStagingTarget(env, cmd), re);
  reject(STAGING, 'rollback', /status\|latest/);
  reject({ ...STAGING, DB_CLIENT: 'sqlite3' }, 'status', /DB_CLIENT harus pg/);
  reject({ ...STAGING, DB_DATABASE: 'edulib' }, 'status', /bukan database staging/);
  reject({ ...STAGING, DB_DATABASE: 'edulib_staging_old' }, 'status', /bukan database staging/);
  reject({ ...STAGING, DB_DATABASE: 'EDULIB_STAGING' }, 'status', /bukan database staging/);
  reject({ ...STAGING, DB_DATABASE: undefined }, 'status', /bukan database staging/);
  reject({ ...STAGING, DB_USER: 'edulib_admin' }, 'status', /bukan role staging/);
  reject(STAGING, 'latest', /CONFIRM_STAGING_DB=edulib_staging/);
  reject({ ...STAGING, CONFIRM_STAGING_DB: 'edulib' }, 'latest', /CONFIRM_STAGING_DB/);
  reject(STAGING, 'unlock', /CONFIRM_STAGING_DB=edulib_staging untuk menjalankan unlock/);
  reject({ ...STAGING, DB_DATABASE: 'edulib', CONFIRM_STAGING_DB: 'edulib' }, 'unlock', /bukan database staging/);
  assert.deepEqual(assertStagingTarget(STAGING, 'status'), { database: 'edulib_staging', user: 'edulib_staging' });
  assert.ok(assertStagingTarget({ ...STAGING, CONFIRM_STAGING_DB: 'edulib_staging' }, 'latest'));
});

test('migrate-staging CLI refuses production target before any DB access', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/migrate-staging.js'), 'latest'], {
    cwd: ROOT, encoding: 'utf8',
    // Host tak terjangkau: kalau guard bocor, error-nya koneksi, bukan "Menolak".
    env: { ...process.env, ...STAGING, DB_HOST: '192.0.2.1', DB_DATABASE: 'edulib', CONFIRM_STAGING_DB: 'edulib' },
    timeout: 20000,
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Menolak: DB_DATABASE "edulib" bukan database staging/);
});

test('migrate-staging refuses when the server reports a different database', async () => {
  serverIdentity = { database: 'edulib', user: 'edulib_staging' };
  const before = queries.length;
  await assert.rejects(
    migrateStaging(['latest'], { ...STAGING, CONFIRM_STAGING_DB: 'edulib_staging' }),
    /server melaporkan edulib_staging@edulib/,
  );
  assert.equal(queries.length - before, 1, 'tidak boleh ada query setelah identitas server tidak cocok');
  serverIdentity = { database: 'edulib_staging', user: 'edulib_staging' };
});

test('seed-db: pg string COUNT counts as non-empty; inserted ids propagate via returning', async () => {
  const knex = require('knex')({ client: 'pg', connection: {} });
  try {
    catalogCount = '3';
    await assert.rejects(assertEmptyCatalog(knex), /fields sudah berisi 3 baris/);
    catalogCount = '0';
    await assertEmptyCatalog(knex);

    queries.length = 0;
    nextId = 100;
    assert.deepEqual(await seedSample(knex), { fields: 5, sub_fields: 7, contents: 8 });
    const inserts = (table) => queries.filter((q) => q.sql.startsWith(`insert into "${table}"`));
    assert.equal(inserts('fields').length, 5);
    for (const q of [...inserts('fields'), ...inserts('sub_fields')]) assert.match(q.sql, /returning "id"$/);
    // fields mendapat id 100..104; sub-bidang pertama ('marketing') milik field 'management' = 100.
    const firstSub = inserts('sub_fields')[0];
    assert.ok(firstSub.bindings.includes(100), JSON.stringify(firstSub.bindings));
    assert.ok(firstSub.bindings.includes('marketing'));
    // contents pertama milik sub_fields 'marketing' = 105.
    assert.ok(inserts('contents')[0].bindings.includes(105));
    assert.ok(inserts('fields')[0].bindings.includes(true), 'is_active harus boolean true untuk PostgreSQL');
  } finally {
    await knex.destroy();
  }
});

test('create-admin uses returning id on pg (stub driver, child process)', () => {
  const stub = `
    const PgClient = require(${JSON.stringify(require.resolve('knex/lib/dialects/postgres'))});
    const seen = [];
    let selects = 0;
    PgClient.prototype.acquireConnection = async () => ({});
    PgClient.prototype.releaseConnection = async () => {};
    PgClient.prototype._query = async function (c, obj) {
      const sql = obj.sql.toLowerCase();
      seen.push(obj.sql);
      if (sql.startsWith('select')) {
        const rows = selects++ === 0 ? [] : [{ id: 42, email: 'pg@admin.test', full_name: 'PG Admin', role: 'admin' }];
        obj.response = { command: 'SELECT', rowCount: rows.length, rows };
      } else if (sql.startsWith('insert')) {
        obj.response = { command: 'INSERT', rowCount: 1, rows: /returning "id"/.test(sql) ? [{ id: 42 }] : [] };
      } else throw new Error('unexpected ' + obj.sql);
      return obj;
    };
    process.on('exit', () => console.log('INSERTS=' + JSON.stringify(seen.filter((s) => s.startsWith('insert')))));
    require(${JSON.stringify(path.join(ROOT, 'scripts/create-admin.js'))});
  `;
  const r = spawnSync(process.execPath, ['-e', stub], {
    cwd: ROOT, encoding: 'utf8',
    env: { ...process.env, ADMIN_EMAIL: 'pg@admin.test', ADMIN_NAME: 'PG Admin', ADMIN_PASSWORD: 'secret-pass' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /User admin dibuat \(id=42\)/);
  const inserts = JSON.parse(r.stdout.match(/INSERTS=(.*)/)[1]);
  assert.equal(inserts.length, 1);
  assert.match(inserts[0], /^insert into "users" .* returning "id"$/);
  assert.doesNotMatch(r.stdout + r.stderr, /secret-pass/);
});
