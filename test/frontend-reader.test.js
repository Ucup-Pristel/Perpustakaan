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
// 60 pages, every 5th landscape: restoring page 30 (landscape) makes the initial
// estimate wrong for most pages above it, so background measurement must not jump.
const BIG_SIZES = Array(300).fill([600, 800]);
const SIXTY_SIZES = Array.from({ length: 60 }, (_, i) => (i + 1) % 5 === 0 ? [800, 600] : [600, 800]);

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
// Count pdf.js worker page-metadata requests and how many slots existed at the time.
window.getPageMsgs = [];
window.firstMount = 0;
new MutationObserver(() => { if (!window.firstMount) window.firstMount = document.querySelectorAll('.react-pdf__Page').length; }).observe(document.documentElement, { subtree: true, childList: true });
const nativePost = Worker.prototype.postMessage;
Worker.prototype.postMessage = function (msg, ...rest) {
  if (msg && msg.action === 'GetPage') window.getPageMsgs.push({ page: msg.data.pageIndex + 1, slots: document.querySelectorAll('[data-page]').length });
  return nativePost.call(this, msg, ...rest);
};
window.saved = Number(new URLSearchParams(location.search).get('saved') || 1);
localStorage.setItem('token', 'e30.' + btoa(JSON.stringify({ exp: 4102444800 })) + '.fixture');
localStorage.setItem('user', JSON.stringify({ id: 1, role: 'member' }));
const nativeFetch = window.fetch;
window.fetch = async (url, opts = {}) => {
  if (!String(url).includes('/api/')) return nativeFetch(url, opts);
  const p = new URL(url, location.origin).pathname;
  window.calls.push({ path: p, search: new URL(url, location.origin).search, method: opts.method || 'GET', body: opts.body && JSON.parse(opts.body) });
  let data;
  if (p.startsWith('/api/contents/')) { await new Promise(resolve => setTimeout(resolve, 100)); data = { id: Number(p.split('/').pop()), title: 'Fixture PDF ' + p.split('/').pop(), content_type: 'pdf', file_url: ({ 3: '/fixture-long.pdf', 4: '/fixture-60.pdf', 5: '/fixture-300.pdf' })[p.split('/').pop()] || '/fixture.pdf' }; }
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
// Mirrors App.jsx: one route-level Suspense boundary whose fallback replaces the
// whole Reader. Counting its appearances catches pages that suspend mid-scroll.
window.fallbackShown = 0;
function Fallback() { React.useLayoutEffect(() => { window.fallbackShown++; }, []); return React.createElement('div', { id: 'route-fallback' }, 'loading'); }
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode, null,
  React.createElement(AuthProvider, null, React.createElement(MemoryRouter, { initialEntries: ['/read/' + (new URLSearchParams(location.search).get('content') || 1)] },
    React.createElement(Nav), React.createElement(React.Suspense, { fallback: React.createElement(Fallback) },
      React.createElement(Routes, null, React.createElement(Route, { path: '/read/:contentId', element: React.createElement(Reader) })))))));
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
      if (req.url === '/fixture-300.pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.end(pdf(BIG_SIZES)); }
      if (req.url === '/fixture-60.pdf') { res.setHeader('Content-Type', 'application/pdf'); return res.end(pdf(SIXTY_SIZES)); }
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

  await t.test('page slots keep identical geometry when canvases are evicted', async () => {
    await open('?content=4', 60);
    await until(() => evaluate(`new Set(window.getPageMsgs.map(m => m.page)).size === 60`), 'all pages measured');
    await new Promise(r => setTimeout(r, 300));
    const before = await heights();
    assert.ok(before[4] < before[0], 'landscape placeholder must follow its own aspect ratio');
    // Visiting page 20 then 40 pushes the resident set past its limit, so the
    // farthest pages (starting with page 1) are evicted.
    await evaluate(`${slot(20)}.scrollIntoView()`);
    await until(() => header('/Hal\\. 20\\/60/'), 'active page 20');
    await evaluate(`${slot(40)}.scrollIntoView()`);
    await until(() => evaluate(`Boolean(${slot(40)}.querySelector('canvas')) && !${slot(1)}.querySelector('canvas')`), 'page 1 evicted, page 40 mounted');
    await new Promise(r => setTimeout(r, 300));
    assert.deepEqual(await heights(), before);
    assert.ok(Math.abs(await slotTop(40) - 24) <= 1, 'page 40 must stay where it was scrolled to');
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

  const mounted = () => evaluate(`[...document.querySelectorAll('[data-page]')].filter(s => s.querySelector('.react-pdf__Page')).map(s => Number(s.dataset.page))`);
  const canvasCount = () => evaluate(`document.querySelectorAll('canvas').length`);
  const painted = n => evaluate(`(() => { const c = ${slot(n)}.querySelector('canvas'); return !!c && c.width > 0 && getComputedStyle(c).visibility !== 'hidden'; })()`);
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const hasAll = async pages => { const m = await mounted(); return pages.every(p => m.includes(p)); };
  const goTo = async (n, total = 60) => {
    await evaluate(`${slot(n)}.scrollIntoView()`);
    await until(() => header(`/Hal\\. ${n}\\/${total}/`), `active page ${n}`);
  };
  const MAX_RESIDENT = 16;
  const AHEAD = 10;

  await t.test('continuous forward scrolling never replaces the Reader with the route loading fallback', async () => {
    await open('?content=5', 300);
    await new Promise(r => setTimeout(r, 300));
    await evaluate('window.fallbackShown = 0; true');
    for (let n = 2; n <= 30; n++) {
      await evaluate(`${slot(n)}.scrollIntoView()`);
      await new Promise(r => setTimeout(r, 60));
    }
    await until(() => header('/Hal\\. 30\\/300/'), 'reached page 30');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await evaluate('window.fallbackShown'), 0, 'a mounting <Page> suspended the route boundary (Reader blanked, spinner shown)');
  });

  const isReady = n => evaluate(`${slot(n)}.hasAttribute('data-ready')`);

  await t.test('a mounted page is not ready until its canvas render succeeded', async () => {
    await open('?content=5', 300);
    const result = await evaluate(`new Promise(resolve => {
      let violations = 0, mountedNotReady = 0;
      const start = performance.now();
      document.querySelector('[data-page="200"]').scrollIntoView();
      (function sample() {
        for (const s of document.querySelectorAll('[data-page]')) {
          const pageEl = s.querySelector('.react-pdf__Page');
          if (!pageEl) continue;
          const c = s.querySelector('canvas');
          const painted = !!c && c.width > 0 && getComputedStyle(c).visibility !== 'hidden';
          if (s.hasAttribute('data-ready') && !painted) violations++;
          if (!s.hasAttribute('data-ready')) mountedNotReady++;
        }
        if (performance.now() - start < 1500) return requestAnimationFrame(sample);
        resolve({ violations, mountedNotReady });
      })();
    })`);
    assert.equal(result.violations, 0, 'data-ready must only be set after the canvas is painted');
    assert.ok(result.mountedNotReady > 0, 'freshly mounted pages must start not-ready');
    await until(() => isReady(200), 'destination becomes ready');
  });

  await t.test('nearest forward pages are scheduled immediately, not after idle batches', async () => {
    await open('?content=5', 300);
    // Immediate tier = active + 6, mounted within a frame or two of the first render.
    await until(() => hasAll(range(1, 7)), 'immediate forward tier mounted', 1500);
    await until(async () => (await Promise.all(range(1, 7).map(isReady))).every(Boolean), 'immediate tier ready', 4000);
  });

  await t.test('sequential reading always reaches pages that are already rendered', async () => {
    await open('?content=5', 300);
    await until(async () => (await Promise.all(range(2, 7).map(isReady))).every(Boolean), 'initial ready-ahead buffer');
    const notReady = [];
    for (let n = 2; n <= 25; n++) {
      if (!(await isReady(n))) notReady.push(n);
      await evaluate(`${slot(n)}.scrollIntoView()`);
      await new Promise(r => setTimeout(r, 120));
    }
    assert.deepEqual(notReady, [], 'pages reached before their canvas finished rendering');
    await until(() => header('/Hal\\. 25\\/300/'), 'reached page 25');
    await until(async () => (await Promise.all(range(26, 31).map(isReady))).every(Boolean), 'ready-ahead buffer kept after progression');
    assert.ok((await mounted()).length <= MAX_RESIDENT);
  });

  await t.test('startup mounts only the restored neighbourhood, then pre-renders ahead in batches', async () => {
    await open('?content=4', 60);
    const first = await evaluate('window.firstMount');
    assert.ok(first > 0 && first <= 5, `first commit mounted ${first} pages`);
    await until(() => hasAll(range(1, 1 + AHEAD)), 'ahead pre-render grows to AHEAD pages');
    await new Promise(r => setTimeout(r, 500));
    assert.deepEqual(await mounted(), range(1, 1 + AHEAD), 'growth stops at the ahead budget');
  });

  await t.test('pages ahead are rendered before they reach the viewport', async () => {
    await open('?content=4', 60);
    await goTo(5);
    await until(() => hasAll(range(3, 15)), 'ahead window around page 5');
    await until(() => painted(14), 'page 14 painted while page 5 is active');
    await evaluate(`window.kept = ${slot(14)}.querySelector('canvas'); true`);
    for (const n of [7, 9, 11, 14]) await goTo(n);
    assert.equal(await evaluate(`${slot(14)}.querySelector('canvas') === window.kept`), true, 'page 14 must not be remounted when reached');
    assert.ok(await painted(14));
  });

  await t.test('recently visited pages stay mounted across small moves; count stays bounded', async () => {
    await open('?content=4', 60);
    await goTo(10);
    await until(() => painted(8), 'page 8 painted');
    await evaluate(`window.kept = ${slot(8)}.querySelector('canvas'); true`);
    for (const n of [12, 9, 13]) {
      await goTo(n);
      await new Promise(r => setTimeout(r, 150));
      const m = await mounted();
      assert.ok(m.length <= MAX_RESIDENT, `mounted ${m.length} at page ${n}: ${m}`);
      assert.ok(await canvasCount() <= MAX_RESIDENT);
    }
    assert.equal(await evaluate(`${slot(8)}.querySelector('canvas') === window.kept`), true, 'page 8 (behind) must not be remounted');
  });

  await t.test('far jump evicts farthest pages first, keeps the destination and stays bounded', async () => {
    await open('?content=4', 60);
    for (const n of [5, 10, 15]) await goTo(n);
    await goTo(50);
    await until(() => hasAll(range(48, 52)), 'destination neighbourhood mounted');
    await until(() => hasAll(range(48, 60)), 'pages ahead of the destination pre-rendered');
    const m = await mounted();
    assert.ok(m.length <= MAX_RESIDENT, `mounted ${m.length}: ${m}`);
    assert.ok(await canvasCount() <= MAX_RESIDENT);
    const old = m.filter(p => p < 40);
    assert.ok(!old.includes(1), `farthest page must be evicted first: ${m}`);
    assert.ok(old.every(p => p >= Math.max(...old) - old.length + 1), `survivors must be the old pages closest to page 50: ${m}`);
    await goTo(8);
    await until(() => hasAll(range(6, 18)), 'old region re-rendered after jumping back');
    assert.ok((await mounted()).length <= MAX_RESIDENT);
  });

  await t.test('300-page PDF stays bounded while reading forward and after a far jump', async () => {
    await open('?content=5', 300);
    for (let n = 2; n <= 30; n += 2) {
      await evaluate(`${slot(n)}.scrollIntoView()`);
      await new Promise(r => setTimeout(r, 40));
    }
    await until(() => header('/Hal\\. 30\\/300/'), 'reached page 30');
    await until(() => hasAll(range(28, 40)), 'ahead window around page 30');
    assert.ok((await mounted()).length <= MAX_RESIDENT);
    assert.ok(await canvasCount() <= MAX_RESIDENT);
    await goTo(250, 300);
    await until(() => hasAll(range(248, 252)), 'destination mounted');
    await new Promise(r => setTimeout(r, 300));
    assert.ok((await mounted()).length <= MAX_RESIDENT);
    assert.ok(await canvasCount() <= MAX_RESIDENT);
  });

  await t.test('startup measures only pages near the restored page; metadata cached once per page', async () => {
    await open('?content=4&saved=30', 60);
    const beforeSlots = await evaluate(`window.getPageMsgs.filter(m => m.slots === 0).map(m => m.page)`);
    // Only restored ±2 is awaited; the ±3 prefetch range may be dispatched in
    // parallel. Anything beyond that before the first slot = all-pages scan.
    assert.ok(beforeSlots.length <= 7, `getPage calls before first slot: ${beforeSlots.length}`);
    assert.ok(beforeSlots.every(p => p >= 27 && p <= 33), `early pages must surround the restored page: ${beforeSlots}`);
    // Background measurement finishes the rest without duplicate worker requests.
    await until(() => evaluate(`new Set(window.getPageMsgs.map(m => m.page)).size === 60`), 'all pages measured');
    await new Promise(r => setTimeout(r, 300));
    assert.equal(await evaluate('window.getPageMsgs.length'), 60, 'each page requested from the worker exactly once');
  });

  await t.test('restored landscape page stays put while background metadata corrects estimates', async () => {
    // Page 30 is landscape, so every portrait page above it starts with a wrong
    // estimated height and grows when measured.
    await open('?content=4&saved=30', 60);
    await until(() => header('/Hal\\. 30\\/60/'), 'restored page 30');
    await until(() => evaluate(`new Set(window.getPageMsgs.map(m => m.page)).size === 60`), 'all pages measured');
    await new Promise(r => setTimeout(r, 500));
    const h = await heights();
    assert.ok(h[0] > h[4] && h[4] === h[29], `portrait pages taller than landscape: ${h.slice(0, 5)}`);
    assert.ok(Math.abs(await slotTop(30) - 24) <= 1, `page 30 drifted to ${await slotTop(30)}`);
    assert.ok(await header('/Hal\\. 30\\/60/'));
  });

  await t.test('sidebar toggle rescales canvases without re-rendering or hiding them', async () => {
    await open('?content=3&saved=6', 12);
    await until(() => header('/Hal\\. 6\\/12/'), 'restored page 6');
    await until(() => evaluate(`!!${slot(6)}.querySelector('canvas') && getComputedStyle(${slot(6)}.querySelector('canvas')).visibility !== 'hidden'`), 'page 6 painted');
    const result = await evaluate(`new Promise(resolve => {
      const canvas = ${slot(6)}.querySelector('canvas');
      const width = canvas.width;
      let hiddenFrames = 0;
      const start = performance.now();
      document.querySelector('button[title="Tutup panel catatan"]').click();
      (function sample() {
        const current = ${slot(6)}.querySelector('canvas');
        if (!current || getComputedStyle(current).visibility === 'hidden') hiddenFrames++;
        if (performance.now() - start < 1000) return requestAnimationFrame(sample);
        resolve({ same: current === canvas, widthKept: current.width === width, hiddenFrames });
      })();
    })`);
    assert.deepEqual(result, { same: true, widthKept: true, hiddenFrames: 0 });
  });
});
