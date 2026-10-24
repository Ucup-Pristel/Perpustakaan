/**
 * ucup-edu-lib :: Regression test ID hasil INSERT pada SQLite (DB sementara)
 *
 * Pasangan dari insert-ids.pg.test.js: memastikan `.returning('id')` tetap
 * mengembalikan ID numerik yang benar di SQLite, dan ID di response API
 * menunjuk ke baris yang benar-benar tersimpan.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-insert-ids-'));
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILENAME = path.join(temp, 'insert-ids.db');
process.env.JWT_SECRET = 'isolated-insert-ids-test-secret';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';
execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe',
});

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

const createdId = async (res, message) => {
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.status, 'success');
  assert.equal(body.message, message);
  assert.ok(Number.isInteger(body.data.id) && body.data.id > 0, `id = ${JSON.stringify(body.data.id)}`);
  return body;
};

test.before(async () => {
  await db('users').insert({ id: 1, email: 'admin@ids.test', password_hash: 'x', full_name: 'Admin', role: 'admin' });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('sqlite: fields, sub_fields and contents POST return the stored row id', async () => {
  const field = await createdId(await postJson('/api/fields', { slug: 'f1', name: 'F1' }), 'Field berhasil ditambahkan');
  assert.deepEqual(Object.keys(field.data), ['id']);
  assert.equal((await db('fields').where({ id: field.data.id }).first()).slug, 'f1');

  const sub = await createdId(
    await postJson('/api/subfields', { field_id: field.data.id, slug: 's1', name: 'S1' }),
    'Sub-bidang berhasil ditambahkan',
  );
  assert.deepEqual(Object.keys(sub.data), ['id']);
  assert.equal((await db('sub_fields').where({ id: sub.data.id }).first()).field_id, field.data.id);

  const ids = [];
  for (const title of ['C1', 'C2']) {
    const c = await createdId(
      await postJson('/api/contents', { sub_field_id: sub.data.id, title, level: 1 }),
      'Konten berhasil ditambahkan',
    );
    assert.deepEqual(Object.keys(c.data), ['id']);
    assert.equal((await db('contents').where({ id: c.data.id }).first()).title, title);
    ids.push(c.data.id);
  }
  assert.equal(ids[1], ids[0] + 1, 'setiap insert harus mengembalikan ID barisnya sendiri');
});

test('sqlite: POST /api/admin/upload returns stored id with R2 urls', async () => {
  const form = new FormData();
  form.append('pdf', new Blob(['%PDF-1.4 minimal'], { type: 'application/pdf' }), 'ok.pdf');
  form.append('cover', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'c.png');
  form.append('title', 'Uploaded');
  const res = await fetch(`${base}/api/admin/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form,
  });
  const body = await createdId(res, 'Upload berhasil');
  assert.deepEqual(body.data, {
    id: body.data.id,
    file_url: 'https://cdn.test.local/pdfs/stub.bin',
    cover_url: 'https://cdn.test.local/covers/stub.bin',
  });
  const row = await db('contents').where({ id: body.data.id }).first();
  assert.equal(row.title, 'Uploaded');
  assert.equal(row.file_url, body.data.file_url);
});
