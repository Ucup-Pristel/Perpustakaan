/**
 * ucup-edu-lib :: multer upload behaviour (synthetic, no R2): size limit
 * boundary, temp-file cleanup after success/rejection, and no orphan temp file
 * after a client aborts mid-upload. Passes on multer 2.3.0 and 2.5.0: it guards
 * against regressions from the upgrade, it does NOT reproduce the
 * GHSA-3pph-fpjx-jg34 race (needs an engine still writing when abort cleanup runs).
 *
 * Temp files land in <repo>/tmp, shared with other test files running in
 * parallel. Every upload here uses a per-run unique extension (diskFilename
 * keeps path.extname(originalname)), so only this file's temp files are counted.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-upload-'));
process.env.DB_CLIENT = 'sqlite3';
process.env.DB_FILENAME = path.join(temp, 'upload.db');
process.env.JWT_SECRET = 'isolated-upload-test-secret';
process.env.R2_PUBLIC_URL = 'https://cdn.test.local';
process.env.NODE_ENV = 'test';
execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'pipe',
});

// R2 never contacted: record calls and check the temp file still exists at upload time.
const storage = require('../backend/utils/r2Uploader');
const r2Calls = [];
storage.uploadToR2 = async (filePath, _name, folder) => {
  r2Calls.push({ folder, existed: fs.existsSync(filePath), size: fs.statSync(filePath).size });
  return `https://cdn.test.local/${folder}/stub.bin`;
};
storage.deleteFromR2 = async () => {};

const jwt = require('jsonwebtoken');
const app = require('../backend/server');
const db = require('../backend/models/db');

const TMP_DIR = path.resolve(__dirname, '../tmp');
const EXT = `.t${crypto.randomBytes(4).toString('hex')}`;
const token = jwt.sign({ id: 1, role: 'admin' }, process.env.JWT_SECRET);
const MIB2 = 2 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
let server;
let base;

const ours = () => fs.readdirSync(TMP_DIR).filter((f) => f.endsWith(EXT));
async function until(fn, what, ms = 5000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const post = (url, form) => fetch(`${base}${url}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
const png = (size) => new Blob([Buffer.concat([PNG, Buffer.alloc(size - PNG.length)])], { type: 'image/png' });

test.before(async () => {
  await db('users').insert({ id: 1, email: 'admin@upload.test', password_hash: 'x', full_name: 'Admin', role: 'admin' });
  await db('contents').insert({ id: 1, title: 'Cover target', content_type: 'pdf', file_url: '/pdfs/a.pdf', level: 1 });
  await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  for (const f of ours()) fs.rmSync(path.join(TMP_DIR, f), { force: true });
  if (server) await new Promise((resolve) => server.close(resolve));
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('cover size limit: exactly 2 MiB accepted, 2 MiB + 1 rejected 400; temp files removed', async () => {
  const ok = new FormData();
  ok.append('cover', png(MIB2), `c${EXT}`);
  const res = await post('/api/admin/contents/1/cover', ok);
  assert.equal(res.status, 200);
  assert.deepEqual(r2Calls.at(-1), { folder: 'covers', existed: true, size: MIB2 });

  const big = new FormData();
  big.append('cover', png(MIB2 + 1), `c${EXT}`);
  const rej = await post('/api/admin/contents/1/cover', big);
  assert.equal(rej.status, 400);
  assert.equal((await rej.json()).message, 'File too large');
  assert.equal(r2Calls.length, 1, 'oversized file must not reach R2');

  await until(() => ours().length === 0, 'temp files cleaned after success and size rejection');
});

test('PDF + cover upload streams temp files to R2 stub, then removes them', async () => {
  const form = new FormData();
  form.append('pdf', new Blob(['%PDF-1.4 synthetic'], { type: 'application/pdf' }), `b${EXT}`);
  form.append('cover', png(64), `c${EXT}`);
  form.append('title', 'Synthetic');
  const res = await post('/api/admin/upload', form);
  assert.equal(res.status, 201);
  assert.deepEqual(r2Calls.slice(-2).map((c) => [c.folder, c.existed]), [['pdfs', true], ['covers', true]]);
  await until(() => ours().length === 0, 'temp files cleaned after upload');
});

test('client abort mid-upload leaves no orphan temp file and server keeps serving', async () => {
  const boundary = `----t111${crypto.randomBytes(8).toString('hex')}`;
  const req = http.request(`${base}/api/admin/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(50 * 1024 * 1024), // promised, never sent
    },
  });
  req.on('error', () => {}); // socket destroyed on purpose
  req.write(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="a${EXT}"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
  req.write(Buffer.alloc(512 * 1024, 0x20));

  await until(() => ours().length === 1, 'temp file created before abort');
  req.destroy();

  await until(() => ours().length === 0, 'orphan temp file removed after abort');
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});
