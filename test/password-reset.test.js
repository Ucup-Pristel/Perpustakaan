'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-password-reset-'));
const dbFile = path.join(temp, 'password-reset.db');

process.env.DB_FILENAME = dbFile;
process.env.JWT_SECRET = 'isolated-password-reset-test-secret';
process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 'test-resend-key';
process.env.MAIL_FROM = 'Ucup Edu Lib <no-reply@test.local>';
process.env.PASSWORD_RESET_BASE_URL = 'https://edulib.test';

execFileSync(process.execPath, ['node_modules/knex/bin/cli.js', 'migrate:latest'], {
  cwd: ROOT,
  env: process.env,
  stdio: 'pipe',
});

const sentEmails = [];
let failMailer = false;
let mailDelayMs = 0;
let mailer;
try {
  mailer = require('../backend/utils/mailer');
  mailer.sendPasswordResetEmail = async message => {
    if (mailDelayMs) await new Promise(resolve => setTimeout(resolve, mailDelayMs));
    if (failMailer) {
      const error = new Error('provider unavailable');
      error.code = 'MAIL_PROVIDER_ERROR';
      throw error;
    }
    sentEmails.push(message);
  };
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
}

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../backend/server');
const db = require('../backend/models/db');

const GENERIC_RESPONSE = {
  status: 'success',
  message: 'Jika email terdaftar, instruksi reset password akan dikirim. Periksa inbox dan folder spam.',
};

let server;
let base;
let resetToken;
let oldSessionToken;

const post = (url, body, headers = {}) => fetch(`${base}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

const waitFor = async (predicate, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for background password-reset work');
};

const reset = (token, password, headers = {}) => post('/api/auth/reset-password', { token, password }, headers);

test.before(async () => {
  await db('users').insert({
    id: 1,
    email: 'registered@example.com',
    full_name: 'Registered User',
    password_hash: await bcrypt.hash('old-password', 10),
  });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.destroy();
  fs.rmSync(temp, { recursive: true, force: true });
});

test('forgot-password for existing email returns generic success', async () => {
  const response = await post('/api/auth/forgot-password', { email: 'registered@example.com' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), GENERIC_RESPONSE);
  await waitFor(() => sentEmails.length === 1);
  assert.equal(sentEmails.length, 1);
  assert.equal(sentEmails[0].to, 'registered@example.com');

  const resetUrl = new URL(sentEmails[0].resetUrl);
  assert.equal(resetUrl.origin, 'https://edulib.test');
  assert.equal(resetUrl.pathname, '/reset-password');
  resetToken = resetUrl.searchParams.get('token');
  assert.match(resetToken, /^[A-Za-z0-9_-]{43}$/);
});

test('forgot-password for unknown email returns the same generic success', async () => {
  const response = await post('/api/auth/forgot-password', { email: 'does-not-exist@example.com' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), GENERIC_RESPONSE);
  assert.equal(sentEmails.length, 1);
});

test('forgot-password stores only the SHA-256 reset-token hash', async () => {
  const row = await db('password_reset_tokens').where({ user_id: 1 }).first();
  assert.ok(row);
  assert.notEqual(row.token_hash, resetToken);
  assert.equal(row.token_hash, crypto.createHash('sha256').update(resetToken).digest('hex'));

  const serializedRows = JSON.stringify(await db('password_reset_tokens'));
  assert.equal(serializedRows.includes(resetToken), false);
});

test('login JWT contains the current session version before reset', async () => {
  const response = await post('/api/auth/login', {
    email: 'registered@example.com',
    password: 'old-password',
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(jwt.decode(body.token).sv, 0);
  assert.equal(body.data.session_version, undefined);
  oldSessionToken = body.token;
});

test('valid reset changes the password and increments session_version', async () => {
  const response = await reset(resetToken, 'new-password');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'success');

  const user = await db('users').where({ id: 1 }).first();
  assert.equal(user.session_version, 1);
  assert.equal(await bcrypt.compare('old-password', user.password_hash), false);
  assert.equal(await bcrypt.compare('new-password', user.password_hash), true);
});

test('JWT issued before reset is rejected and the new password works', async () => {
  const oldSessionResponse = await fetch(`${base}/api/activity/summary`, {
    headers: { Authorization: `Bearer ${oldSessionToken}` },
  });
  assert.equal(oldSessionResponse.status, 401);

  const oldPasswordResponse = await post('/api/auth/login', {
    email: 'registered@example.com',
    password: 'old-password',
  });
  assert.equal(oldPasswordResponse.status, 401);

  const newPasswordResponse = await post('/api/auth/login', {
    email: 'registered@example.com',
    password: 'new-password',
  });
  assert.equal(newPasswordResponse.status, 200);
  const body = await newPasswordResponse.json();
  assert.equal(jwt.decode(body.token).sv, 1);
});

test('a reset token cannot be reused', async () => {
  const response = await reset(resetToken, 'another-password');
  assert.equal(response.status, 400);
});

test('expired and malformed reset tokens are rejected', async () => {
  const expiredToken = 'E'.repeat(43);
  await db('password_reset_tokens').insert({
    user_id: 1,
    token_hash: crypto.createHash('sha256').update(expiredToken).digest('hex'),
    expires_at: new Date(Date.now() - 1000),
  });
  assert.equal((await reset(expiredToken, 'valid-password')).status, 400);
  assert.equal((await reset('not-a-valid-reset-token', 'valid-password')).status, 400);
});

test('reset password enforces the bcrypt UTF-8 byte limit and minimum length', async () => {
  assert.equal((await reset('V'.repeat(43), 'x'.repeat(73))).status, 400);
  assert.equal((await reset('W'.repeat(43), '12345')).status, 400);
  assert.equal((await reset('X'.repeat(43), 'é'.repeat(37))).status, 400);
});

test('another forgot-password request replaces the previous unused token', async () => {
  const first = await post('/api/auth/forgot-password', { email: 'registered@example.com' });
  assert.equal(first.status, 200);
  const oldReplacementToken = new URL(sentEmails.at(-1).resetUrl).searchParams.get('token');

  const second = await post('/api/auth/forgot-password', { email: 'registered@example.com' });
  assert.equal(second.status, 200);
  const newestReplacementToken = new URL(sentEmails.at(-1).resetUrl).searchParams.get('token');
  assert.notEqual(oldReplacementToken, newestReplacementToken);
  assert.equal(await db('password_reset_tokens').where({ user_id: 1 }).whereNull('used_at').count('* as count').first().then(row => Number(row.count)), 1);

  assert.equal((await reset(oldReplacementToken, 'replacement-password')).status, 400);
  assert.equal((await reset(newestReplacementToken, 'replacement-password')).status, 200);
});

test('concurrent reset attempts can consume a token only once', async () => {
  await db('users').insert({
    id: 2,
    email: 'concurrent@example.com',
    full_name: 'Concurrent User',
    password_hash: await bcrypt.hash('old-concurrent', 10),
  });
  const concurrentToken = 'C'.repeat(43);
  await db('password_reset_tokens').insert({
    user_id: 2,
    token_hash: crypto.createHash('sha256').update(concurrentToken).digest('hex'),
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
  });

  const responses = await Promise.all([
    reset(concurrentToken, 'concurrent-password', { 'X-Forwarded-For': '10.30.0.4' }),
    reset(concurrentToken, 'concurrent-password', { 'X-Forwarded-For': '10.30.0.4' }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 400]);
  assert.equal((await db('users').where({ id: 2 }).first()).session_version, 1);
});

test('deleting a user cascades password reset tokens', async () => {
  await db('users').insert({
    id: 3,
    email: 'cascade@example.com',
    full_name: 'Cascade User',
    password_hash: 'not-used',
  });
  await db('password_reset_tokens').insert({
    user_id: 3,
    token_hash: 'D'.repeat(64),
    expires_at: new Date(Date.now() + 30 * 60 * 1000),
  });
  await db('users').where({ id: 3 }).del();
  assert.equal(await db('password_reset_tokens').where({ user_id: 3 }).first(), undefined);
});

test('missing mail configuration returns the same service error for known and unknown emails', async () => {
  const savedKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  const known = await post('/api/auth/forgot-password', { email: 'registered@example.com' }, { 'X-Forwarded-For': '10.20.0.1' });
  const unknown = await post('/api/auth/forgot-password', { email: 'missing@example.com' }, { 'X-Forwarded-For': '10.20.0.2' });
  assert.equal(known.status, 503);
  assert.deepEqual(await known.json(), await unknown.json());
  process.env.RESEND_API_KEY = savedKey;
});

test('reset base URL requires HTTPS outside local development', () => {
  const saved = {
    NODE_ENV: process.env.NODE_ENV,
    PASSWORD_RESET_BASE_URL: process.env.PASSWORD_RESET_BASE_URL,
  };
  try {
    process.env.NODE_ENV = 'production';
    process.env.PASSWORD_RESET_BASE_URL = 'http://edulib.test';
    assert.equal(mailer.getPasswordResetConfig(), null);

    process.env.PASSWORD_RESET_BASE_URL = 'https://edulib.test';
    assert.equal(mailer.getPasswordResetConfig().resetBaseUrl, 'https://edulib.test');

    process.env.NODE_ENV = 'test';
    process.env.PASSWORD_RESET_BASE_URL = 'http://localhost:5173';
    assert.equal(mailer.getPasswordResetConfig().resetBaseUrl, 'http://localhost:5173');
    process.env.PASSWORD_RESET_BASE_URL = 'http://127.0.0.1:5173';
    assert.equal(mailer.getPasswordResetConfig().resetBaseUrl, 'http://127.0.0.1:5173');
    process.env.PASSWORD_RESET_BASE_URL = 'http://[::1]:5173';
    assert.equal(mailer.getPasswordResetConfig().resetBaseUrl, 'http://[::1]:5173');
    process.env.PASSWORD_RESET_BASE_URL = 'http://edulib.test';
    assert.equal(mailer.getPasswordResetConfig(), null);
  } finally {
    process.env.NODE_ENV = saved.NODE_ENV;
    process.env.PASSWORD_RESET_BASE_URL = saved.PASSWORD_RESET_BASE_URL;
  }
});

test('email-provider failure remains generic and does not leave an active token', async () => {
  failMailer = true;
  const response = await post('/api/auth/forgot-password', { email: 'registered@example.com' }, { 'X-Forwarded-For': '10.20.0.3' });
  failMailer = false;
  assert.deepEqual(await response.json(), GENERIC_RESPONSE);
  await waitFor(async () => !(await db('password_reset_tokens').where({ user_id: 1 }).whereNull('used_at').first()));
  assert.equal(await db('password_reset_tokens').where({ user_id: 1 }).whereNull('used_at').first(), undefined);
});

test('slow email delivery does not materially delay the forgot-password response', async () => {
  const initialEmailCount = sentEmails.length;
  mailDelayMs = 700;
  try {
    const timedPost = async (email, ip) => {
      const startedAt = performance.now();
      const response = await post('/api/auth/forgot-password', { email }, { 'X-Forwarded-For': ip });
      return { response, elapsedMs: performance.now() - startedAt };
    };
    const [known, unknown] = await Promise.all([
      timedPost('registered@example.com', '10.40.0.1'),
      timedPost('slow-missing@example.com', '10.40.0.2'),
    ]);

    assert.equal(known.response.status, 200);
    assert.equal(unknown.response.status, 200);
    assert.ok(known.elapsedMs < mailDelayMs / 2, `known request took ${known.elapsedMs}ms`);
    assert.ok(Math.abs(known.elapsedMs - unknown.elapsedMs) < 250, `${known.elapsedMs}ms vs ${unknown.elapsedMs}ms`);
    await waitFor(() => sentEmails.length === initialEmailCount + 1);
  } finally {
    mailDelayMs = 0;
  }
});
