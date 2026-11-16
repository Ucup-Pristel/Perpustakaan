/**
 * ucup-edu-lib :: Regression test pencarian GET /api/contents/search (PostgreSQL)
 *
 * SQLite LIKE case-insensitive untuk ASCII, PostgreSQL LIKE case-sensitive.
 * Dengan `where(col, 'like', ...)`, pencarian "marketing" di PG tidak menemukan
 * judul "Digital Marketing" padahal di SQLite ketemu. whereILike/orWhereILike
 * dikompilasi menjadi ILIKE di PG dan LIKE di SQLite.
 *
 * Tidak ada server PostgreSQL di CI/lokal: route ASLI dijalankan dengan client
 * Knex `pg` asli; hanya koneksi driver yang di-stub. Stub mengevaluasi SQL yang
 * dikirim dengan semantik PG (LIKE peka huruf besar/kecil, ILIKE tidak).
 * Runtime PG 17 sungguhan tetap BELUM terverifikasi di sini.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_CLIENT = 'pg';
process.env.DB_HOST = '127.0.0.1';
process.env.DB_DATABASE = 'stub_never_connected';
process.env.JWT_SECRET = 'isolated-pg-contents-search-test-secret';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';

const Knex = require('knex');
const PgClient = require('knex/lib/dialects/postgres');

const ROWS = [
  { id: 1, title: 'Digital Marketing Dasar', author: 'Budi', tags: '["bisnis"]', level: 1, file_url: null, cover_url: null },
  { id: 3, title: 'Strategi Brand', author: 'Sari', tags: '["MARKETING"]', level: 3, file_url: null, cover_url: null },
  { id: 5, title: 'Marketing Lanjut', author: 'Dewi', tags: null, level: 4, file_url: '/pdfs/m.pdf', cover_url: null },
];
const queries = [];

// Pola LIKE/ILIKE -> RegExp (hanya % dan _ yang dipakai route ini).
const likeToRegExp = (pattern, insensitive) => new RegExp(
  `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.')}$`,
  insensitive ? 'is' : 's',
);

PgClient.prototype.acquireConnection = async () => ({ __stub: true });
PgClient.prototype.releaseConnection = async () => {};
PgClient.prototype._query = async function _query(connection, obj) {
  queries.push({ sql: obj.sql, bindings: obj.bindings });
  const m = obj.sql.match(/^select \* from "contents" where \((.+?)\)( and "level" in \(([^)]+)\))? order by "level" asc, "id" asc limit \$(\d+)$/);
  if (!m) throw new Error(`Query tak terduga di stub pg: ${obj.sql}`);
  const at = (ph) => obj.bindings[Number(ph.slice(1)) - 1];
  const conds = m[1].split(' or ').map((c) => {
    const [, col, op, ph] = c.match(/^"(\w+)" (like|ilike) (\$\d+)$/);
    return { col, re: likeToRegExp(at(ph), op === 'ilike') };
  });
  const levels = m[3] ? m[3].split(', ').map(at) : null;
  const rows = ROWS
    .filter((r) => conds.some(({ col, re }) => r[col] !== null && re.test(r[col])))
    .filter((r) => !levels || levels.includes(r.level))
    .slice(0, at(`$${m[4]}`));
  obj.response = { command: 'SELECT', rowCount: rows.length, rows };
  return obj;
};

const app = require('../backend/server');
const db = require('../backend/models/db');

let server;
let base;
const search = async (qs) => {
  const res = await fetch(`${base}/api/contents/search?${qs}`);
  return { status: res.status, body: await res.json() };
};

test.before(async () => {
  assert.equal(db.client.config.client, 'pg');
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
});

test('pg: mixed-case term finds title, author and tags matches regardless of case', async () => {
  for (const q of ['marketing', 'MARKETING', 'MaRkEtInG']) {
    const { status, body } = await search(`q=${q}`);
    assert.equal(status, 200, q);
    assert.equal(body.status, 'success');
    assert.deepEqual(body.data.map((c) => c.id), [1, 3, 5], q);
    assert.deepEqual(body.meta, { total: 3 });
  }
  assert.deepEqual((await search('q=dEWI')).body.data.map((c) => c.id), [5], 'author');
});

test('pg: search SQL uses ILIKE with bound parameters for title, author and tags', async () => {
  await search('q=MaRkEtInG');
  assert.deepEqual(queries.at(-1), {
    sql: 'select * from "contents" where ("title" ilike $1 or "author" ilike $2 or "tags" ilike $3) order by "level" asc, "id" asc limit $4',
    bindings: ['%MaRkEtInG%', '%MaRkEtInG%', '%MaRkEtInG%', 50],
  });
});

test('pg: level filter and limit stay parameterized and keep response shape', async () => {
  const { body } = await search('q=marketing&level=1,4&limit=1');
  assert.deepEqual(queries.at(-1), {
    sql: 'select * from "contents" where ("title" ilike $1 or "author" ilike $2 or "tags" ilike $3) and "level" in ($4, $5) order by "level" asc, "id" asc limit $6',
    bindings: ['%marketing%', '%marketing%', '%marketing%', 1, 4, 1],
  });
  assert.deepEqual(body.data.map((c) => c.id), [1]);
  assert.deepEqual(body.meta, { total: 1 });

  const withFile = (await search('q=lanjut')).body.data[0];
  assert.equal(withFile.file_url, 'https://cdn.test.local/pdfs/m.pdf');
});

test('pg: user input with quotes is bound, never inlined into SQL', async () => {
  const evil = "x' OR '1'='1";
  const { status, body } = await search(`q=${encodeURIComponent(evil)}`);
  assert.equal(status, 200);
  assert.deepEqual(body.data, []);
  const q = queries.at(-1);
  assert.ok(!q.sql.includes(evil), q.sql);
  assert.deepEqual(q.bindings.slice(0, 3), Array(3).fill(`%${evil}%`));
});

test('pg dialect: whereILike/orWhereILike compile to ILIKE', async () => {
  const pg = Knex({ client: 'pg' });
  try {
    const native = pg('contents').where(function () {
      this.whereILike('title', '%Ab%').orWhereILike('author', '%Ab%').orWhereILike('tags', '%Ab%');
    }).toSQL().toNative();
    assert.equal(native.sql, 'select * from "contents" where ("title" ilike $1 or "author" ilike $2 or "tags" ilike $3)');
    assert.deepEqual(native.bindings, ['%Ab%', '%Ab%', '%Ab%']);
  } finally {
    await pg.destroy();
  }
});
