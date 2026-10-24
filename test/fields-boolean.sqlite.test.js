/**
 * ucup-edu-lib :: Regression test filter boolean fields.is_active (SQLite)
 *
 * Pasangan dari fields-boolean.pg.test.js. Di SQLite boolean disimpan sebagai
 * integer 0/1; filter aktif harus tetap mengembalikan baris yang sama setelah
 * binding diganti dari angka 1 ke boolean true.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-fields-bool-'));
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILENAME = path.join(temp, 'fields-bool.db');
process.env.JWT_SECRET = 'isolated-fields-bool-test-secret';
process.env.NODE_ENV = 'test';
execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe',
});

const app = require('../backend/server');
const db = require('../backend/models/db');

let server;
let base;
const get = async (url) => {
  const res = await fetch(`${base}${url}`);
  return { status: res.status, body: await res.json() };
};

test.before(async () => {
  // Campuran cara penulisan boolean: native JS boolean, integer legacy, dan default kolom.
  await db('fields').insert([
    { id: 1, slug: 'aktif-true', name: 'A', sort_order: 2, is_active: true },
    { id: 2, slug: 'aktif-int', name: 'B', sort_order: 1, is_active: 1 },
    { id: 4, slug: 'nonaktif-false', name: 'D', sort_order: 0, is_active: false },
    { id: 5, slug: 'nonaktif-int', name: 'E', sort_order: 0, is_active: 0 },
  ]);
  // Insert terpisah: pada multi-row insert, Knex (useNullAsDefault) mengisi
  // kolom yang tidak disebut dengan NULL sehingga DEFAULT kolom tidak berlaku.
  await db('fields').insert({ id: 3, slug: 'aktif-default', name: 'C', sort_order: 3 });
  await db('sub_fields').insert([
    { id: 1, field_id: 2, slug: 'sub-2b', name: 'S2', sort_order: 2 },
    { id: 2, field_id: 2, slug: 'sub-2a', name: 'S1', sort_order: 1 },
    { id: 3, field_id: 4, slug: 'sub-hidden', name: 'H', sort_order: 1 },
  ]);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('sqlite: GET /api/fields lists only active fields ordered by sort_order', async () => {
  const { status, body } = await get('/api/fields');
  assert.equal(status, 200);
  assert.equal(body.status, 'success');
  assert.deepEqual(body.data.map((f) => f.slug), ['aktif-int', 'aktif-true', 'aktif-default']);
  assert.deepEqual(body.meta, { total: 3 });
  // Kontrak SQLite tidak berubah: nilai integer apa adanya dari driver.
  for (const f of body.data) assert.equal(f.is_active, 1);
});

test('sqlite: GET /api/fields/:slug returns active field with ordered sub_fields', async () => {
  const { status, body } = await get('/api/fields/aktif-int');
  assert.equal(status, 200);
  assert.equal(body.status, 'success');
  assert.equal(body.data.id, 2);
  assert.equal(body.data.is_active, 1);
  assert.deepEqual(body.data.sub_fields.map((s) => s.slug), ['sub-2a', 'sub-2b']);
  assert.deepEqual(body.meta, {});

  for (const slug of ['aktif-true', 'aktif-default']) {
    assert.equal((await get(`/api/fields/${slug}`)).status, 200, slug);
  }
});

test('sqlite: GET /api/fields/:slug hides inactive and unknown fields with 404', async () => {
  for (const slug of ['nonaktif-false', 'nonaktif-int', 'tidak-ada']) {
    const { status, body } = await get(`/api/fields/${slug}`);
    assert.equal(status, 404, slug);
    assert.deepEqual(body, { status: 'error', message: 'Field tidak ditemukan' });
  }
});
