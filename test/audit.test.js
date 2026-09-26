'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-audit-'));
process.env.DB_FILENAME = path.join(temp, 'audit.db');
process.env.JWT_SECRET = 'isolated-audit-test-secret';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';
execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe',
});

// No test may access real object storage, including failure paths.
const storage = require('../backend/utils/r2Uploader');
storage.uploadToR2 = async () => { throw new Error('Unexpected R2 upload'); };
storage.deleteFromR2 = async () => { throw new Error('Unexpected R2 deletion'); };
// Dispatch functions remain replaceable for deterministic storage fault injection.
let uploadObject = storage.uploadToR2;
let deleteObject = storage.deleteFromR2;
storage.uploadToR2 = (...args) => uploadObject(...args);
storage.deleteFromR2 = (...args) => deleteObject(...args);
const app = require('../backend/server');
const db = require('../backend/models/db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
let server;
let base;
const token = (id, role = 'member') => jwt.sign({ id, role }, process.env.JWT_SECRET);
const request = (url, { method = 'GET', body, auth, raw } = {}) => fetch(`${base}${url}`, {
  method,
  headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) },
  body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
});

test.before(async () => {
  await db('users').insert([
    { id: 1, email: 'admin@audit.test', password_hash: 'x', full_name: 'Admin', role: 'admin' },
    { id: 2, email: 'member@audit.test', password_hash: 'x', full_name: 'Member', role: 'member' },
    { id: 3, email: 'demoted@audit.test', password_hash: 'x', full_name: 'Demoted', role: 'admin' },
  ]);
  await db('contents').insert({ id: 1, title: 'Uncategorized PDF', content_type: 'pdf', file_url: '/pdfs/test.pdf', level: 1 });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('demoted admin loses access immediately with existing JWT', async () => {
  const oldToken = token(3, 'admin');
  const changed = await request('/api/admin/users/3/role', {
    method: 'PATCH', auth: token(1, 'admin'), body: { role: 'member' },
  });
  assert.equal(changed.status, 200);
  assert.equal((await db('users').where({ id: 3 }).first()).role, 'member');
  assert.equal((await request('/api/admin/users', { auth: oldToken })).status, 403);
});

test('deleted user JWT cannot access protected data', async () => {
  assert.equal((await request('/api/activity/summary', { auth: token(999) })).status, 401);
});

test('promotion takes effect for existing member JWT', async () => {
  const oldToken = token(2);
  try {
    await db('users').where({ id: 2 }).update({ role: 'admin' });
    assert.equal((await request('/api/admin/users', { auth: oldToken })).status, 200);
  } finally {
    await db('users').where({ id: 2 }).update({ role: 'member' });
  }
});

test('uncategorized content remains readable through detail API', async () => {
  const res = await request('/api/contents/1');
  assert.equal(res.status, 200);
  const { data } = await res.json();
  assert.equal(data.title, 'Uncategorized PDF');
  assert.equal(data.sub_field_name, null);
  assert.equal(data.file_url, 'https://cdn.test.local/pdfs/test.pdf');
});

test('malformed JSON and oversized JSON keep client error status', async () => {
  assert.equal((await request('/api/auth/login', { method: 'POST', raw: '{' })).status, 400);
  assert.equal((await request('/api/auth/login', {
    method: 'POST', body: { padding: 'x'.repeat(110 * 1024) },
  })).status, 413);
});

test('concurrent registration of same email returns conflict, not 500', async () => {
  const body = { email: 'race@audit.test', full_name: 'Race', password: 'test-password' };
  const responses = await Promise.all([1, 2].map(() => request('/api/auth/register', { method: 'POST', body })));
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
  assert.equal((await db('users').where({ email: body.email })).length, 1);
});

test('registration rejects passwords bcrypt silently truncates', async () => {
  for (const password of ['x'.repeat(73), 'é'.repeat(37)]) {
    const res = await request('/api/auth/register', {
      method: 'POST', body: { email: 'long@audit.test', full_name: 'Long', password },
    });
    assert.equal(res.status, 400);
  }
});

test('login cannot accept a different suffix beyond bcrypt byte limit', async () => {
  await db('users').insert({ email: 'prefix@audit.test', full_name: 'Prefix', password_hash: await bcrypt.hash('x'.repeat(72), 10) });
  const res = await request('/api/auth/login', {
    method: 'POST', body: { email: 'prefix@audit.test', password: 'x'.repeat(72) + 'wrong-suffix' },
  });
  assert.equal(res.status, 400);
});

test('notes and progress reject missing content as 404, not database error', async () => {
  for (const url of ['/api/activity/notes', '/api/activity/reading-progress']) {
    const res = await request(url, {
      method: 'POST', auth: token(2), body: { content_id: 99999, last_page: 1, page_number: 1, note_text: 'Hello' },
    });
    assert.equal(res.status, 404);
  }
});

test('activity rejects coercible non-scalar IDs and pages', async () => {
  for (const body of [
    { content_id: true, last_page: 1 },
    { content_id: [1], last_page: 1 },
    { content_id: 1, last_page: true },
    { content_id: 1, last_page: [1] },
  ]) {
    assert.equal((await request('/api/activity/reading-progress', { method: 'POST', auth: token(2), body })).status, 400);
  }
});

test('JSON content writes preserve array tags on round-trip', async () => {
  const created = await request('/api/contents', {
    method: 'POST', auth: token(1, 'admin'),
    body: { title: 'Tagged', content_type: 'pdf', level: 1, tags: ['one', 'two'] },
  });
  assert.equal(created.status, 201);
  const id = (await created.json()).data.id;
  assert.deepEqual((await (await request(`/api/contents/${id}`)).json()).data.tags, ['one', 'two']);
  assert.equal((await request(`/api/contents/${id}`, {
    method: 'PUT', auth: token(1, 'admin'), body: { tags: ['three'] },
  })).status, 200);
  assert.deepEqual((await (await request(`/api/contents/${id}`)).json()).data.tags, ['three']);
});

test('query objects do not trigger 500 in public search and level filters', async () => {
  await db('fields').insert({ id: 1, slug: 'tech', name: 'Tech' });
  await db('sub_fields').insert({ id: 1, field_id: 1, slug: 'se', name: 'SE' });
  for (const url of ['/api/search?q[toString]=x', '/api/contents/search?q[toString]=x', '/api/subfields/se/contents?level[]=1']) {
    assert.equal((await request(url)).status, 400, url);
  }
});

test('cover replacement detects concurrent delete and cleans up uploaded object', async () => {
  const [id] = await db('contents').insert({ title: 'Cover race', level: 1 });
  const removed = [];
  uploadObject = async () => {
    await db('contents').where({ id }).del();
    return 'https://cdn.test.local/covers/new.png';
  };
  deleteObject = async url => removed.push(url);
  const form = new FormData();
  form.append('cover', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/png' }), 'cover.png');
  const res = await fetch(`${base}/api/admin/contents/${id}/cover`, {
    method: 'POST', headers: { Authorization: `Bearer ${token(1, 'admin')}` }, body: form,
  });
  assert.equal(res.status, 409);
  assert.deepEqual(removed, ['https://cdn.test.local/covers/new.png']);
});

test('partial R2 deletion cannot leave live content pointing to deleted PDF', async () => {
  for (const route of ['/api/contents', '/api/admin/contents']) {
    const [id] = await db('contents').insert({ title: 'Delete failure', level: 1, file_url: '/pdfs/delete.pdf', cover_url: '/covers/delete.png' });
    const removed = [];
    deleteObject = async url => {
      removed.push(url);
      if (url.includes('covers')) throw new Error('Injected cover storage failure');
    };
    const res = await request(`${route}/${id}`, { method: 'DELETE', auth: token(1, 'admin') });
    assert.equal(res.status, 200);
    assert.equal(await db('contents').where({ id }).first(), undefined);
    assert.deepEqual(removed.sort(), ['/covers/delete.png', '/pdfs/delete.pdf']);
  }
});
