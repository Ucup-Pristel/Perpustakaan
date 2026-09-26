'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Native data-URL module: substitute Vite env only, execute actual API implementation.
const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src/lib/api.js'), 'utf8')
  .replaceAll('import.meta.env', '({ DEV: true })');
const load = () => import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

test('login 401 preserves credential error and does not expire another session', async t => {
  const api = await load();
  let unauthorized = 0;
  api.setUnauthorizedHandler(() => unauthorized++);
  t.after(() => api.setUnauthorizedHandler(null));
  t.mock.method(global, 'fetch', async () => Response.json({ message: 'Email atau password salah' }, { status: 401 }));
  await assert.rejects(api.apiFetch('/api/auth/login', { method: 'POST', body: '{}' }), { message: 'Email atau password salah', status: 401 });
  assert.equal(unauthorized, 0);
});

test('authenticated 401 identifies failed token; public errors never trigger logout', async t => {
  const api = await load();
  const tokens = [];
  api.setUnauthorizedHandler(token => tokens.push(token));
  t.after(() => api.setUnauthorizedHandler(null));
  t.mock.method(global, 'fetch', async () => Response.json({ message: 'Denied' }, { status: 401 }));
  await assert.rejects(api.apiFetch('/api/activity/summary', { token: 'old-session' }), { status: 401 });
  assert.deepEqual(tokens, ['old-session']);
});

test('API preserves aborts, rate limits, JSON and multipart boundaries', async t => {
  const api = await load();
  const calls = [];
  const fetchMock = t.mock.method(global, 'fetch', async (url, options) => { calls.push({ url, options }); return Response.json({ data: [] }); });
  await api.apiFetch('/api/test', { method: 'POST', body: '{}' });
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  await api.apiFetch('/api/test', { method: 'POST', body: new FormData() });
  assert.equal(calls[1].options.headers['Content-Type'], undefined);
  fetchMock.mock.mockImplementation(async () => { throw new DOMException('Aborted', 'AbortError'); });
  await assert.rejects(api.apiFetch('/api/test'), { name: 'AbortError' });
  fetchMock.mock.mockImplementation(async () => new Response('', { status: 429 }));
  await assert.rejects(api.apiFetch('/api/test'), { status: 429 });
});
