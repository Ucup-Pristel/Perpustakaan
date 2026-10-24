/**
 * ucup-edu-lib :: Regression test ID hasil INSERT pada dialect PostgreSQL
 *
 * Tanpa `.returning('id')`, Knex pg mengembalikan objek Result driver (bukan
 * array ID seperti SQLite), sehingga `const [id] = await db(t).insert(...)`
 * melempar TypeError / menghasilkan id undefined.
 *
 * Tidak ada server PostgreSQL di CI/lokal. Test ini menjalankan route ASLI
 * dengan client Knex `pg` asli (compiler + processResponse), hanya koneksi
 * driver yang diganti stub yang membalas seperti `pg` sungguhan:
 * INSERT tanpa RETURNING -> rows: [], dengan RETURNING -> rows: [{ id }].
 * Perilaku terhadap server PG 17 sungguhan tetap BELUM terverifikasi di sini.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_CLIENT = 'pg';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_DATABASE = 'stub_never_connected';
process.env.JWT_SECRET = 'isolated-pg-insert-test-secret';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';

const PgClient = require('knex/lib/dialects/postgres');

const ADMIN = { id: 1, email: 'admin@pg.test', role: 'admin', session_version: 0 };
const queries = [];
let nextId = 100;

// Tidak pernah membuka socket: koneksi palsu + respons berbentuk pg.Result.
PgClient.prototype.acquireConnection = async () => ({ __stub: true });
PgClient.prototype.releaseConnection = async () => {};
PgClient.prototype._query = async function _query(connection, obj) {
  const sql = obj.sql.toLowerCase();
  queries.push(obj.sql);
  if (sql.startsWith('select')) {
    const rows = sql.includes('from "users"') && sql.includes('"id" =') ? [ADMIN] : [];
    obj.response = { command: 'SELECT', rowCount: rows.length, rows };
  } else if (sql.startsWith('insert')) {
    const rows = /returning "id"/.test(sql) ? [{ id: nextId++ }] : [];
    obj.response = { command: 'INSERT', rowCount: 1, rows };
  } else {
    throw new Error(`Query tak terduga di stub pg: ${obj.sql}`);
  }
  return obj;
};

// R2 tidak boleh disentuh: upload diganti stub deterministik.
const storage = require('../backend/utils/r2Uploader');
storage.uploadToR2 = async (_file, _name, folder) => `https://cdn.test.local/${folder}/stub.bin`;
storage.deleteFromR2 = async () => { throw new Error('Unexpected R2 deletion'); };

const jwt = require('jsonwebtoken');
const app = require('../backend/server');
const db = require('../backend/models/db');

const adminToken = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET);
let server;
let base;

const postJson = (url, body) => fetch(`${base}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
  body: JSON.stringify(body),
});

test.before(async () => {
  assert.equal(db.client.config.client, 'pg');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
});

const expectCreated = async (res, message, extra = {}) => {
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.message, message);
  assert.equal(typeof body.data.id, 'number');
  assert.ok(Number.isInteger(body.data.id) && body.data.id >= 100, `id = ${body.data.id}`);
  for (const [k, v] of Object.entries(extra)) assert.equal(body.data[k], v);
  assert.deepEqual(Object.keys(body.data).sort(), ['id', ...Object.keys(extra)].sort());
  const insert = queries.filter((q) => q.toLowerCase().startsWith('insert')).at(-1);
  assert.match(insert, /returning "id"$/i);
};

test('pg: POST /api/fields returns generated numeric id', async () => {
  await expectCreated(await postJson('/api/fields', { slug: 'f', name: 'F' }), 'Field berhasil ditambahkan');
});

test('pg: POST /api/subfields returns generated numeric id', async () => {
  await expectCreated(await postJson('/api/subfields', { field_id: 1, slug: 's', name: 'S' }), 'Sub-bidang berhasil ditambahkan');
});

test('pg: POST /api/contents returns generated numeric id', async () => {
  await expectCreated(await postJson('/api/contents', { title: 'C', level: 1 }), 'Konten berhasil ditambahkan');
});

test('pg: POST /api/admin/upload returns generated numeric id and R2 urls', async () => {
  const form = new FormData();
  form.append('pdf', new Blob(['%PDF-1.4 minimal'], { type: 'application/pdf' }), 'ok.pdf');
  form.append('title', 'Uploaded');
  const res = await fetch(`${base}/api/admin/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form,
  });
  await expectCreated(res, 'Upload berhasil', {
    file_url: 'https://cdn.test.local/pdfs/stub.bin',
    cover_url: null,
  });
});

test('pg: admin INSERT routes still reject non-admin before touching the DB', async () => {
  const before = queries.length;
  const res = await fetch(`${base}/api/fields`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(res.status, 403);
  assert.equal(queries.length, before);
});
