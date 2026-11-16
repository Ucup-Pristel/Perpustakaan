/**
 * ucup-edu-lib :: Regression test pencarian GET /api/contents/search (SQLite)
 *
 * Pasangan dari contents-search.pg.test.js. SQLite LIKE sudah case-insensitive
 * untuk ASCII; setelah pindah ke whereILike/orWhereILike (yang di SQLite tetap
 * dikompilasi menjadi LIKE) hasil pencarian, filter level, limit dan bentuk
 * response harus tetap sama.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-contents-search-'));
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILENAME = path.join(temp, 'contents-search.db');
process.env.JWT_SECRET = 'isolated-contents-search-test-secret';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';
execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe',
});

const Knex = require('knex');
const app = require('../backend/server');
const db = require('../backend/models/db');

let server;
let base;
const search = async (qs) => {
  const res = await fetch(`${base}/api/contents/search?${qs}`);
  return { status: res.status, body: await res.json() };
};
const ids = (body) => body.data.map((c) => c.id);

test.before(async () => {
  await db('contents').insert([
    { id: 1, title: 'Digital Marketing Dasar', author: 'Budi', tags: '["bisnis"]', level: 1 },
    { id: 2, title: 'Akuntansi', author: 'Marketa Novak', tags: '["keuangan"]', level: 2 },
    { id: 3, title: 'Strategi Brand', author: 'Sari', tags: '["MARKETING","brand"]', level: 3 },
    { id: 4, title: 'Pemrograman Web', author: 'Andi', tags: '["coding"]', level: 1, file_url: '/pdfs/web.pdf' },
    { id: 5, title: 'Marketing Lanjut', author: 'Dewi', tags: null, level: 4 },
  ]);
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('sqlite: mixed-case term matches title, author and tags case-insensitively', async () => {
  for (const q of ['marketing', 'MARKETING', 'MaRkEtInG']) {
    const { status, body } = await search(`q=${q}`);
    assert.equal(status, 200, q);
    assert.equal(body.status, 'success');
    // title (1, 5), author "Marketa" tidak cocok "marketing", tags (3); urut level, id.
    assert.deepEqual(ids(body), [1, 3, 5], q);
    assert.deepEqual(body.meta, { total: 3 });
  }
  assert.deepEqual(ids((await search('q=mARKETA')).body), [2], 'author');
  assert.deepEqual(ids((await search('q=Brand')).body), [3], 'title + tags, tanpa duplikat');
});

test('sqlite: level filter and limit still apply on top of the search', async () => {
  assert.deepEqual(ids((await search('q=Marketing&level=1,4')).body), [1, 5]);
  assert.deepEqual(ids((await search('q=marketing&level=3')).body), [3]);
  assert.deepEqual(ids((await search('q=marketing&limit=1')).body), [1]);
  const none = await search('q=tidak-ada-sama-sekali');
  assert.equal(none.status, 200);
  assert.deepEqual(none.body, { status: 'success', data: [], meta: { total: 0 } });
});

test('sqlite: response items keep formatContent shape (prefixed file_url)', async () => {
  const { body } = await search('q=WEB');
  assert.equal(body.data.length, 1);
  assert.equal(body.data[0].id, 4);
  assert.equal(body.data[0].file_url, 'https://cdn.test.local/pdfs/web.pdf');
});

test('sqlite dialect: whereILike compiles to parameterized LIKE (SQLite has no ILIKE)', async () => {
  const sq = Knex({ client: 'sqlite3', useNullAsDefault: true });
  try {
    const native = sq('contents').where(function () {
      this.whereILike('title', '%Ab%').orWhereILike('author', '%Ab%').orWhereILike('tags', '%Ab%');
    }).toSQL().toNative();
    assert.equal(native.sql, 'select * from `contents` where (`title` like ? or `author` like ? or `tags` like ?)');
    assert.deepEqual(native.bindings, ['%Ab%', '%Ab%', '%Ab%']);
  } finally {
    await sq.destroy();
  }
});
