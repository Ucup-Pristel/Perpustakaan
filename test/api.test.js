/**
 * ucup-edu-lib :: Integration test jalur kritis
 * Jalankan: npm test   (node:test, stdlib — tanpa framework tambahan)
 *
 * Test ini memakai DB SEMENTARA hasil migration, bukan database/ucup-edu-lib.db,
 * supaya data asli tidak tersentuh. Server dijalankan in-process lewat
 * app.listen(0) pada port acak.
 *
 * Cakupan: regresi yang pernah lolos ke main —
 *   - LIMIT -1 mengembalikan seluruh tabel (sekarang 400)
 *   - file_url dobel prefix di /api/subfields/:slug/contents
 *   - upload menerima non-PDF di field pdf
 *   - FK/CASCADE tidak aktif
 *   - route mutasi bisa diakses non-admin
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP_DB = path.join(os.tmpdir(), `ucup-test-${process.pid}.db`);

// Env harus disiapkan SEBELUM require app/db, karena knex membaca env saat load.
process.env.DB_FILENAME = TMP_DB;
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-only-for-node-test';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';

execFileSync('npx', ['knex', 'migrate:latest'], {
  cwd: ROOT,
  env: { ...process.env, DB_FILENAME: TMP_DB },
  stdio: 'pipe',
});

const jwt = require('jsonwebtoken');
const app = require('../backend/server');
const db = require('../backend/models/db');

const adminToken = jwt.sign({ id: 1, email: 'admin@test.id', role: 'admin' }, process.env.JWT_SECRET);
const memberToken = jwt.sign({ id: 2, email: 'member@test.id', role: 'member' }, process.env.JWT_SECRET);

let base;
let server;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;

  await db('fields').insert({ id: 1, slug: 'tech', name: 'Teknologi', is_active: 1, sort_order: 1 });
  await db('sub_fields').insert({ id: 1, field_id: 1, slug: 'se', name: 'RPL', sort_order: 1 });
  await db('users').insert([
    { id: 1, email: 'admin@test.id', password_hash: 'x', full_name: 'Admin', role: 'admin' },
    { id: 2, email: 'member@test.id', password_hash: 'x', full_name: 'Member', role: 'member' },
  ]);

  // file_url RELATIF -> harus di-prefix R2_PUBLIC_URL
  await db('contents').insert({
    id: 1, sub_field_id: 1, title: 'Relatif', level: 1,
    content_type: 'pdf', file_url: '/pdfs/relatif.pdf', language: 'id',
  });
  // file_url ABSOLUT -> TIDAK boleh di-prefix lagi (regresi dobel prefix)
  await db('contents').insert({
    id: 2, sub_field_id: 1, title: 'Absolut', level: 2,
    content_type: 'pdf', file_url: 'https://cdn.test.local/pdfs/absolut.pdf', language: 'id',
  });
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await db.destroy();
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(TMP_DB + suffix, { force: true });
  }
});

const get = (p, headers) => fetch(`${base}${p}`, { headers });

test('health check menjawab ok', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'ok');
});

test('pagination menolak input invalid, bukan mengembalikan seluruh tabel', async () => {
  // LIMIT -1 di SQLite = tanpa batas. Ini pernah balas 200 + semua baris.
  for (const q of ['limit=-1', 'limit=0', 'limit=101', 'limit=1.5', 'limit=abc', 'page=0', 'page=abc', 'field_id=abc']) {
    const res = await get(`/api/contents?${q}`);
    assert.equal(res.status, 400, `${q} seharusnya 400, dapat ${res.status}`);
    assert.equal((await res.json()).status, 'error');
  }
});

test('pagination valid mengembalikan meta yang benar', async () => {
  const res = await get('/api/contents?page=1&limit=1');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.length, 1);
  assert.equal(body.meta.limit, 1);
  assert.equal(body.meta.total, 2);
  assert.equal(body.meta.total_pages, 2);
});

test('search dibatasi limit dan menolak limit invalid', async () => {
  const res = await get('/api/contents/search?q=a&limit=1');
  assert.equal(res.status, 200);
  assert.ok((await res.json()).data.length <= 1);

  assert.equal((await get('/api/contents/search?q=a&limit=-1')).status, 400);
  assert.equal((await get('/api/contents/search')).status, 400); // q wajib
});

test('file_url absolut tidak di-prefix dua kali', async () => {
  const res = await get('/api/subfields/se/contents');
  assert.equal(res.status, 200);
  const rows = (await res.json()).data;

  const absolut = rows.find((r) => r.id === 2);
  assert.equal(absolut.file_url, 'https://cdn.test.local/pdfs/absolut.pdf');
  assert.equal((absolut.file_url.match(/https:\/\//g) || []).length, 1, 'dobel prefix kembali!');

  const relatif = rows.find((r) => r.id === 1);
  assert.equal(relatif.file_url, 'https://cdn.test.local/pdfs/relatif.pdf');
});

test('detail konten memakai logika URL yang sama', async () => {
  const body = await (await get('/api/contents/2')).json();
  assert.equal((body.data.file_url.match(/https:\/\//g) || []).length, 1);
});

test('route mutasi menolak tanpa token dan non-admin', async () => {
  const targets = [
    ['POST', '/api/fields'],
    ['PUT', '/api/fields/1'],
    ['DELETE', '/api/fields/1'],
    ['POST', '/api/subfields'],
    ['POST', '/api/contents'],
    ['DELETE', '/api/contents/1'],
  ];
  for (const [method, url] of targets) {
    const anon = await fetch(`${base}${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    assert.ok(anon.status === 401 || anon.status === 403, `${method} ${url} anon = ${anon.status}`);

    const member = await fetch(`${base}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${memberToken}` },
      body: '{}',
    });
    assert.equal(member.status, 403, `${method} ${url} member = ${member.status}`);
  }
});

test('token dengan secret salah ditolak', async () => {
  const forged = jwt.sign({ id: 1, role: 'admin' }, 'secret-yang-salah');
  const res = await fetch(`${base}/api/fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${forged}` },
    body: '{}',
  });
  assert.equal(res.status, 401);
});

test('upload menolak non-PDF di field pdf dan metadata invalid', async () => {
  const pdf = new Blob(['%PDF-1.4 minimal'], { type: 'application/pdf' });
  const png = new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' });

  const post = (form) => fetch(`${base}/api/admin/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form,
  });

  // PNG dikirim sebagai field pdf -> ditolak fileFilter
  const f1 = new FormData();
  f1.append('pdf', png, 'x.png');
  f1.append('title', 'X');
  assert.equal((await post(f1)).status, 400);

  // mimetype dipalsukan application/pdf tapi isi bukan PDF -> ditolak magic bytes
  const f2 = new FormData();
  f2.append('pdf', new Blob(['plain text'], { type: 'application/pdf' }), 'fake.pdf');
  f2.append('title', 'X');
  assert.equal((await post(f2)).status, 400);

  // metadata invalid -> ditolak SEBELUM upload R2
  for (const [k, v] of [['level', '9'], ['sub_field_id', '99999'], ['sub_field_id', 'abc'], ['language', 'xx']]) {
    const f = new FormData();
    f.append('pdf', pdf, 'ok.pdf');
    f.append('title', 'X');
    f.append(k, v);
    assert.equal((await post(f)).status, 400, `${k}=${v} seharusnya 400`);
  }

  // judul wajib
  const f3 = new FormData();
  f3.append('pdf', pdf, 'ok.pdf');
  assert.equal((await post(f3)).status, 400);

  // member tidak boleh upload
  const f4 = new FormData();
  f4.append('pdf', pdf, 'ok.pdf');
  f4.append('title', 'X');
  const memberRes = await fetch(`${base}/api/admin/upload`, {
    method: 'POST', headers: { Authorization: `Bearer ${memberToken}` }, body: f4,
  });
  assert.equal(memberRes.status, 403);
});

test('FK aktif dan ON DELETE CASCADE bekerja', async () => {
  const [{ foreign_keys: fk }] = await db.raw('PRAGMA foreign_keys');
  assert.equal(fk, 1, 'FK enforcement tidak aktif');

  await db('notes').insert({ user_id: 1, content_id: 1, page_number: 1, note_text: 'catatan' });
  await db('reading_progress').insert({ user_id: 1, content_id: 1, last_page: 3 });

  // insert dengan content_id tidak ada harus ditolak
  await assert.rejects(
    db('notes').insert({ user_id: 1, content_id: 99999, page_number: 1, note_text: 'orphan' }),
    /FOREIGN KEY/i,
  );

  // hapus konten -> anak ikut terhapus
  await db('contents').where('id', 1).del();
  assert.equal(Number((await db('notes').where('content_id', 1).count('* as c').first()).c), 0);
  assert.equal(Number((await db('reading_progress').where('content_id', 1).count('* as c').first()).c), 0);

  const violations = await db.raw('PRAGMA foreign_key_check');
  assert.equal(violations.length, 0);
});

test('endpoint tidak dikenal menjawab 404 JSON', async () => {
  const res = await get('/api/tidak-ada');
  assert.equal(res.status, 404);
  assert.equal((await res.json()).status, 'error');
});
