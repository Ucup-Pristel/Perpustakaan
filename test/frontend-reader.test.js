'use strict';
// node --test test/frontend-reader.test.js — Chrome + installed frontend deps; no backend/network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../frontend');
const chrome = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
const available = chrome && fs.existsSync(path.join(root, 'node_modules/vite/dist/node/index.js'));

// Long fixture mixes portrait and landscape pages (4, 8, 12) so placeholder height
// must come from each page's own aspect ratio, not one constant.
const LONG_SIZES = Array.from({ length: 12 }, (_, i) => (i + 1) % 4 === 0 ? [800, 600] : [600, 800]);

function pdf(sizes = Array(3).fill([600, 800])) {
  const kids = sizes.map((_, i) => `${i + 3} 0 R`).join(' ');
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${sizes.length} >>`];
  for (const [w, h] of sizes) objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << >> >>`);
  let text = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj, i) => { offsets.push(Buffer.byteLength(text)); text += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('');
  return text + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
}

const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { AuthProvider } from '/src/context/AuthContext.jsx';
import Reader from '/src/pages/Reader.jsx';
import '/src/index.css';
window.calls = [];
window.pending = {};
window.signals = {};
window.saved = Number(new URLSearchParams(location.search).get('saved') || 1);
localStorage.setItem('token', 'e30.' + btoa(JSON.stringify({ exp: 4102444800 })) + '.fixture');
localStorage.setItem('user', JSON.stringify({ id: 1, role: 'member' }));
const nativeFetch = window.fetch;
window.fetch = async (url, opts = {}) => {
  if (!String(url).includes('/api/')) return nativeFetch(url, opts);
  const p = new URL(url, location.origin).pathname;
  window.calls.push({ path: p, search: new URL(url, location.origin).search, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });
  let data;
  if (p.startsWith('/api/contents/')) { await new Promise(resolve => setTimeout(resolve, 100)); data = { id: Number(p.split('/').pop()), title: 'Fixture PDF ' + p.split('/').pop(), content_type: 'pdf', file_url: p.endsWith('/3') ? '/fixture-long.pdf' : '/fixture.pdf' }; }
  else if (p.startsWith('/api/activity/reading-progress/')) data = { last_page_read: window.saved };
  else if (p === '/api/activity/reading-progress') {
    if (window.holdProgress) await new Promise(resolve => { window.pending.progress = resolve; });
    data = {};
  } else if (p === '/api/activity/notes') {
    data = { ...JSON.parse(opts.body), id: 1 };
    if (window.holdNote) await new Promise(resolve => { window.pending.note = resolve; });
  } else if (p.startsWith('/api/activity/notes/')) {
    const page = Number(new URL(url, location.origin).searchParams.get('page_number'));
    window.signals[page] = opts.signal;
    data = [{ id: page, page_number: page, note_text: 'Note page ' + page }];
    if (window.holdNotesRead) await new Promise(resolve => { window.pending.notesRead = resolve; });
  } else throw new Error('Unexpected API: ' + p);
  return Response.json({ status: 'success', data });
};
function Nav() { window.go = useNavigate(); return null; }
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
  React.createElement(AuthProvider, null, React.createElement(MemoryRouter, { initialEntries: ['/read/' + (new URLSearchParams(location.search).get('content') || 1)] },
    React.createElement(Nav), React.createElement(Routes, null, React.createElement(Route, { path: '/read/:contentId', element: React.createElement(Reader) }))))));
`;

async function until(fn, label, timeout = 12000) {
  const end = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 30)); } while (Date.now() < end);
  throw new Error('Timeout: ' + label);
}

test('Reader browser regressions', { skip: available ? false : 'Needs Chrome and npm ci in frontend', timeout: 60000 }, async t => {
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  const server = await createServer({ root, configFile: false, envDir: false, server: { host: '127.0.0.1', port: 0 },
    optimizeDeps: { include: ['react', 'react-dom/client', 'react-router-dom', 'react-pdf', 'lucide-react'] },
    plugins: [{ name: 'local-test-fixtures', resolveId(id) { if (id === '/test-entry.js') return path.join(root, 'test-entry.js'); },
      load(id) { if (id === path.join(root, 'test-entry.js')) return entry; },
      configureServer(s) { s.middlewares.use((req, res, next) => {
      if (req.url.startsWith('/reader-test')) { res.setHeader('Content-Type', 'text/html'); return res.end('<html><body><div id="root"></div><script type="module" src="/test-entry.js"></script></body></html>'); }
      if (req.url === '/fixture.pdf') { res.setHeader('Content-Type', 'application/pdf'); return setTimeout(() => res.end(pdf()), 100); }
      if (req.url === '/fixture-long.pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.end(pdf(LONG_SIZES)); }
      next();
    }); } }] });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-browser-'));
  let browser, socket;
  t.after(async () => {
    socket?.close();
    if (browser && browser.exitCode === null) { browser.kill(); await new Promise(r => browser.once('exit', r)); }
    await server.close();
    fs.rmSync(profile, { recursive: true, force: true });
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile), 'Chrome debugging port');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r, { once: true }));
  let sequence = 0;
  const requests = new Map();
  socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.id) { requests.get(msg.id)?.(msg); requests.delete(msg.id); } });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    requests.set(id, msg => msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  await cdp('Runtime.enable');
  socket.addEventListener('message', event => { const msg = JSON.parse(event.data); if (msg.method === 'Runtime.exceptionThrown') console.error(JSON.stringify(msg.params)); });
  await cdp('Network.enable');
  await cdp('Network.setBlockedURLs', { urls: ['https://*'] });
  const open = async (query = '', pages = 3) => {
    await cdp('Page.navigate', { url: `${origin}/reader-test${query}` });
    try {
      await until(() => evaluate(`document.querySelectorAll("[data-page]").length === ${pages} && document.querySelectorAll("canvas").length > 0`), 'PDF wrappers and canvas');
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    }
    catch (err) { console.error(await evaluate('({url: location.href, html: document.documentElement.outerHTML, calls: window.calls, resources: performance.getEntriesByType("resource").map(r => ({name:r.name,status:r.responseStatus}))})')); throw err; }
  };

  await t.test('delayed PDF load attaches width observer and renders canvases', async () => {
    await open();
    await new Promise(r => setTimeout(r, 500));
    assert.ok(await evaluate('document.querySelectorAll("canvas").length'), 'Loaded PDF must render canvases, not permanent placeholders');
  });

  await t.test('note form cannot submit previous page text while next page loads', async () => {
    await open();
    await until(() => evaluate('document.querySelector("textarea").value === "Note page 1"'), 'page one note');
    await evaluate('window.holdNotesRead = true; document.querySelector("[data-page=\\"2\\"]").scrollIntoView()');
    await until(() => evaluate('Boolean(window.pending.notesRead)'), 'page two request');
    assert.equal(await evaluate('document.querySelector("button[type=submit]").disabled'), true);
    assert.equal(await evaluate('document.querySelector("textarea").value'), '');
  });

  await t.test('late note save cannot overwrite another page draft', async () => {
    await open();
    await until(() => evaluate('document.querySelector("textarea").value === "Note page 1"'), 'page one note');
    await evaluate('window.holdNote = true; document.querySelector("form").requestSubmit()');
    await until(() => evaluate('Boolean(window.pending.note)'), 'pending note save');
    await evaluate('document.querySelector("[data-page=\\"2\\"]").scrollIntoView()');
    await until(() => evaluate('document.querySelector("textarea").value === "Note page 2"'), 'page two note');
    await evaluate('window.pending.note()');
    await new Promise(r => setTimeout(r, 100));
    assert.equal(await evaluate('document.querySelector("textarea").value'), 'Note page 2');
  });

  await t.test('switching books with equal page counts keeps scroll tracking', async () => {
    await open();
    await evaluate('window.go("/read/2")');
    await until(() => evaluate('document.querySelector("header")?.innerText.includes("Fixture PDF 2") && document.querySelectorAll("canvas").length > 0'), 'second book');
    await evaluate('document.querySelector("[data-page=\\"2\\"]").scrollIntoView()');
    await new Promise(r => setTimeout(r, 800));
    assert.match(await evaluate('document.querySelector("header").innerText'), /Hal\. 2\/3/);
  });

  // Long fixture (content 3): 12 pages, pages 4/8/12 landscape.
  const slot = n => `document.querySelector('[data-page="${n}"]')`;
  const header = re => evaluate(`${re}.test(document.querySelector('header').innerText)`);
  const slotTop = n => evaluate(`${slot(n)}.getBoundingClientRect().top - document.querySelector('main').getBoundingClientRect().top`);
  const heights = () => evaluate(`[...document.querySelectorAll('[data-page]')].map(el => Math.round(el.getBoundingClientRect().height))`);
  const noteReads = () => evaluate(`window.calls.filter(c => c.path.startsWith('/api/activity/notes/')).map(c => c.search)`);

  await t.test('page slots keep identical geometry when canvases mount/unmount', async () => {
    await open('?content=3', 12);
    const before = await heights();
    assert.ok(before[3] < before[0], 'landscape placeholder must follow its own aspect ratio');
    await evaluate(`${slot(8)}.scrollIntoView()`);
    await until(() => evaluate(`Boolean(${slot(8)}.querySelector('canvas')) && !${slot(1)}.querySelector('canvas')`), 'render window moved to page 8');
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(await heights(), before);
    assert.ok(Math.abs(await slotTop(8) - 24) <= 1, 'page 8 must stay where it was scrolled to');
  });

  await t.test('restored page lands in view and progress saving still works', async () => {
    await open('?content=3&saved=9', 12);
    await until(() => header('/Hal\\. 9\\/12/'), 'restored page 9');
    await new Promise(r => setTimeout(r, 800));
    assert.ok(Math.abs(await slotTop(9) - 24) <= 1, 'restored page must not drift after neighbours render');
    assert.ok(await header('/Hal\\. 9\\/12/'));
    assert.equal(await evaluate(`window.calls.filter(c => c.path === '/api/activity/reading-progress').length`), 0);
    await evaluate(`${slot(10)}.scrollIntoView()`);
    await until(() => evaluate(`window.calls.some(c => c.path === '/api/activity/reading-progress' && c.body.last_page === 10)`), 'progress saved for page 10');
  });

  await t.test('rapid scrolling loads notes only for the page it settles on', async () => {
    await open('?content=3', 12);
    await until(() => evaluate(`document.querySelector('textarea').value === 'Note page 1'`), 'page one note');
    await evaluate('window.calls.length = 0');
    for (let p = 2; p <= 7; p++) {
      await evaluate(`${slot(p)}.scrollIntoView()`);
      await new Promise(r => setTimeout(r, 50));
    }
    await until(() => evaluate(`document.querySelector('textarea').value === 'Note page 7'`), 'settled page note');
    assert.deepEqual(await noteReads(), ['?page_number=7']);
  });

  await t.test('in-flight notes request for a page left behind is aborted', async () => {
    await open('?content=3', 12);
    await until(() => evaluate(`document.querySelector('textarea').value === 'Note page 1'`), 'page one note');
    await evaluate(`window.holdNotesRead = true; ${slot(2)}.scrollIntoView()`);
    await until(() => evaluate('Boolean(window.signals[2])'), 'page two request in flight');
    assert.equal(await evaluate('window.signals[2].aborted'), false);
    await evaluate(`${slot(3)}.scrollIntoView()`);
    await until(() => evaluate('window.signals[2].aborted'), 'stale page two request aborted');
    await until(() => evaluate('Boolean(window.signals[3])'), 'page three request');
    assert.equal(await evaluate('window.signals[3].aborted'), false);
    await evaluate('window.holdNotesRead = false; window.pending.notesRead()');
    await until(() => evaluate(`document.querySelector('textarea').value === 'Note page 3'`), 'page three note');
  });

  await t.test('toggling the notes sidebar keeps the reading position', async () => {
    await open('?content=3&saved=6', 12);
    await until(() => header('/Hal\\. 6\\/12/'), 'restored page 6');
    await new Promise(r => setTimeout(r, 300));
    await evaluate(`document.querySelector('button[title="Tutup panel catatan"]').click()`);
    await new Promise(r => setTimeout(r, 1000));
    assert.ok(await header('/Hal\\. 6\\/12/'));
    assert.ok(Math.abs(await slotTop(6) - 24) <= 3, 'page 6 must stay at the top after the width change');
  });
});
