/**
 * ucup-edu-lib :: Regression test filter boolean fields.is_active (PostgreSQL)
 *
 * `fields.is_active` dibuat lewat t.boolean() -> kolom BOOLEAN native di PG.
 * `.where('is_active', 1)` mengirim parameter integer, dan PostgreSQL menolak
 * `boolean = integer` (SQLSTATE 42883), sehingga GET /api/fields dan
 * /api/fields/:slug menjawab 500.
 *
 * Tidak ada server PostgreSQL di CI/lokal: route ASLI dijalankan dengan client
 * Knex `pg` asli; hanya koneksi driver yang di-stub. Stub meniru penolakan PG
 * untuk parameter non-boolean pada is_active. Runtime PG 17 sungguhan tetap
 * BELUM terverifikasi di sini.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_CLIENT = 'pg';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_DATABASE = 'stub_never_connected';
process.env.JWT_SECRET = 'isolated-pg-fields-bool-test-secret';
process.env.NODE_ENV = 'test';

const Knex = require('knex');
const PgClient = require('knex/lib/dialects/postgres');

const FIELDS = [
  { id: 2, slug: 'aktif', name: 'Aktif', sort_order: 1, is_active: true },
];
const SUB_FIELDS = [{ id: 7, field_id: 2, slug: 'sub', name: 'Sub', sort_order: 1 }];
const queries = [];

PgClient.prototype.acquireConnection = async () => ({ __stub: true });
PgClient.prototype.releaseConnection = async () => {};
PgClient.prototype._query = async function _query(connection, obj) {
  queries.push({ sql: obj.sql, bindings: obj.bindings });
  const sql = obj.sql.toLowerCase();
  if (!sql.startsWith('select')) throw new Error(`Query tak terduga di stub pg: ${obj.sql}`);

  if (sql.includes('from "fields"')) {
    // Tiru PostgreSQL: kolom BOOLEAN tidak bisa dibandingkan dengan integer.
    const m = obj.sql.match(/"is_active" = \$(\d+)/);
    assert.ok(m, `query fields tanpa filter is_active: ${obj.sql}`);
    const value = obj.bindings[Number(m[1]) - 1];
    if (typeof value !== 'boolean') {
      throw Object.assign(new Error('operator does not exist: boolean = integer'), { code: '42883' });
    }
    let rows = FIELDS.filter((f) => f.is_active === value);
    const slug = obj.sql.match(/"slug" = \$(\d+)/);
    if (slug) rows = rows.filter((f) => f.slug === obj.bindings[Number(slug[1]) - 1]);
    obj.response = { command: 'SELECT', rowCount: rows.length, rows };
  } else if (sql.includes('from "sub_fields"')) {
    obj.response = { command: 'SELECT', rowCount: SUB_FIELDS.length, rows: SUB_FIELDS };
  } else {
    throw new Error(`Query tak terduga di stub pg: ${obj.sql}`);
  }
  return obj;
};

const app = require('../backend/server');
const db = require('../backend/models/db');

let server;
let base;
const get = async (url) => {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, body: await res.json() };
};
const lastFieldsQuery = () => queries.filter((q) => /from "fields"/i.test(q.sql)).at(-1);

test.before(async () => {
  assert.equal(db.client.config.client, 'pg');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
});

test('pg: GET /api/fields binds is_active as boolean true and returns active fields', async () => {
  const { status, body } = await get('/api/fields');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'success', data: FIELDS, meta: { total: 1 } });

  const q = lastFieldsQuery();
  assert.equal(q.sql, 'select * from "fields" where "is_active" = $1 order by "sort_order" asc');
  assert.deepEqual(q.bindings, [true]);
});

test('pg: GET /api/fields/:slug binds is_active as boolean true and returns detail', async () => {
  const { status, body } = await get('/api/fields/aktif');
  assert.equal(status, 200);
  assert.deepEqual(body, { status: 'success', data: { ...FIELDS[0], sub_fields: SUB_FIELDS }, meta: {} });

  const q = lastFieldsQuery();
  assert.equal(q.sql, 'select * from "fields" where "slug" = $1 and "is_active" = $2 limit $3');
  assert.deepEqual(q.bindings, ['aktif', true, 1]);
});

test('pg: GET /api/fields/:slug keeps 404 contract for unknown slug', async () => {
  const { status, body } = await get('/api/fields/tidak-ada');
  assert.equal(status, 404);
  assert.deepEqual(body, { status: 'error', message: 'Field tidak ditemukan' });
});

test('pg dialect: boolean filter compiles to native boolean literal, never integer', async () => {
  const pg = Knex({ client: 'pg' });
  try {
    assert.equal(
      pg('fields').where('is_active', true).orderBy('sort_order', 'asc').toString(),
      'select * from "fields" where "is_active" = true order by "sort_order" asc',
    );
    assert.equal(
      pg('fields').where({ slug: 'x', is_active: true }).first().toString(),
      'select * from "fields" where "slug" = \'x\' and "is_active" = true limit 1',
    );
  } finally {
    await pg.destroy();
  }
});
