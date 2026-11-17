'use strict';
// Real Chromium + the actual Vite landing page, with a deliberately offline API.
// Run: node --test test/frontend-hero-parallax.test.js
// Optional: HERO_ARTIFACT_DIR=/absolute/path saves viewport screenshots.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBrowserLifecycle } = require('./helpers/browser-lifecycle');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../frontend');
const chrome = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
const available = chrome && fs.existsSync(chrome) && typeof globalThis.WebSocket === 'function' && fs.existsSync(path.join(root, 'node_modules/vite/dist/node/index.js'));
// CI must fail if prerequisites disappear; local backend-only runs may skip.
if (process.env.CI) assert.ok(available, 'Browser regressions are mandatory in CI: install frontend dependencies and provide Chrome/WebSocket (Node 22).');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  do {
    const result = await fn();
    if (result) return result;
    await delay(50);
  } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}

test('Hero parallax: offline landing, scroll choreography and accessibility', {
  skip: available ? false : 'Needs Chrome and npm ci in frontend', timeout: 120000,
}, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hero-parallax-'));
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));
  let apiOnline = false;
  const fixtureContents = [
    { id: 1, title: 'Clean Code', cover_url: '/__covers/portrait.svg' },
    { id: 2, title: 'Strategi SEO Terkini', cover_url: '/__covers/missing.svg' },
    { id: 3, title: 'API landscape cover', cover_url: '/__covers/landscape.svg' },
  ];
  const fixtureEntry = `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {BrowserRouter} from 'react-router-dom';
    import HeroParallax from '/src/components/ui/HeroParallax.jsx';
    import {buildHeroCards} from '/src/lib/heroCovers.js';
    import '/src/index.css';
    const root = createRoot(document.getElementById('root'));
    window.showHero = contents => root.render(<BrowserRouter><HeroParallax cards={buildHeroCards(contents)} /></BrowserRouter>);
    window.showHero([]);
  `;
  const server = await createServer({
    root, envDir: false, cacheDir: path.join(temp, 'vite-cache'),
    define: { 'import.meta.env.VITE_API_URL': '""', 'import.meta.env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING': '""' },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'hero-test-fixtures',
      resolveId(id) { if (id === '/hero-fixture.jsx') return path.join(root, 'hero-fixture.jsx'); },
      load(id) { if (id === path.join(root, 'hero-fixture.jsx')) return fixtureEntry; },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname === '/hero-fixture') {
            res.setHeader('Content-Type', 'text/html');
            vite.transformIndexHtml(req.url, '<html><body><div id="root"></div><script type="module" src="/hero-fixture.jsx"></script></body></html>')
              .then(html => res.end(html)).catch(next);
            return;
          }
          if (url.pathname.startsWith('/api/')) {
            res.setHeader('Content-Type', 'application/json');
            res.statusCode = apiOnline ? 200 : 503;
            return res.end(JSON.stringify(apiOnline
              ? { status: 'success', data: url.pathname === '/api/fields' ? [{ id: 1, name: 'Teknologi', is_active: true }] : fixtureContents }
              : { status: 'error', message: 'Deliberately offline in browser test' }));
          }
          if (url.pathname.startsWith('/__covers/')) {
            if (url.pathname.includes('missing')) { res.statusCode = 404; return res.end(); }
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${url.pathname.includes('landscape') ? 1200 : 600}" height="900"><rect width="100%" height="100%" fill="#c65d28"/></svg>`);
          }
          next();
        });
      },
    }],
  });
  const lifecycle = createBrowserLifecycle();
  let socket;
  t.after(() => lifecycle.cleanup({ socket, server, directory: temp }));
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  const profile = path.join(temp, 'chrome');
  lifecycle.spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-background-networking', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank']);
  const portFile = path.join(profile, 'DevToolsActivePort');
  await until(() => fs.existsSync(portFile), 'Chrome startup');
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
  const tabs = await until(async () => {
    try { return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { return false; }
  }, 'Chrome debugging endpoint');
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const requests = new Map(), exceptions = [];
  socket.addEventListener('message', event => {
    const msg = JSON.parse(event.data);
    if (msg.id) { requests.get(msg.id)?.(msg); requests.delete(msg.id); }
    if (msg.method === 'Runtime.exceptionThrown') exceptions.push(msg.params.exceptionDetails);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    requests.set(id, msg => msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await cdp('Runtime.enable');
  const viewport = async (width, height, reduced = false) => {
    await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
  };
  const navigate = async (route = '/') => {
    await cdp('Page.navigate', { url: origin + route });
    await until(() => evaluate('document.querySelectorAll(".hero-book").length === 24'), '24 cover slots');
    await delay(900);
  };
  const screenshot = async name => {
    if (!process.env.HERO_ARTIFACT_DIR) return;
    fs.mkdirSync(process.env.HERO_ARTIFACT_DIR, { recursive: true });
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.HERO_ARTIFACT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'));
  };
  const sample = () => evaluate(`(() => {
    const hero = document.querySelector('.hero-parallax');
    const plane = hero.querySelector('.hero-book-plane');
    const style = getComputedStyle(plane);
    const transform = new DOMMatrix(style.transform);
    return {
      width: document.documentElement.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth,
      top: hero.offsetTop, height: hero.offsetHeight, y: transform.m42, opacity: +style.opacity,
      tilt: style.transform.startsWith('matrix3d'),
      rows: [...hero.querySelectorAll('.hero-book-row')].map(row => {
        const cards = [...row.children];
        const boxes = cards.map(card => card.getBoundingClientRect());
        return { x: new DOMMatrix(getComputedStyle(row).transform).m41,
          left: Math.min(...boxes.map(b => b.left)), right: Math.max(...boxes.map(b => b.right)),
          bottom: Math.max(...boxes.map(b => b.bottom)) + scrollY,
          count: cards.length, ratio: cards[0].offsetWidth / cards[0].offsetHeight,
        };
      }),
    };
  })()`);
  const scrollToProgress = async progress => {
    await evaluate(`(() => { const h=document.querySelector('.hero-parallax');window.scrollTo({top:h.offsetTop+h.offsetHeight*${progress},behavior:'instant'}); })()`);
    await delay(700);
    return sample();
  };

  await t.test('offline desktop: three portrait rows and original reveal timing', async () => {
    await viewport(1440, 900);
    await navigate();
    const initial = await sample();
    assert.equal(await evaluate('document.querySelectorAll("h1").length'), 1);
    assert.equal(await evaluate('[...document.querySelectorAll(".hero-book-plane a")].filter(a=>a.tabIndex!==-1).length'), 0);
    assert.equal(initial.tilt, true);
    assert.ok(Math.abs(initial.opacity - 0.2) < 0.01);
    await screenshot('desktop-start');
    for (const progress of [0.05, 0.1, 0.2, 0.4, 0.65, 0.9]) {
      const state = await scrollToProgress(progress);
      assert.equal(state.overflow, false);
      assert.deepEqual(state.rows.map(row => row.count), [8, 8, 8]);
      assert.ok(state.rows.every(row => Math.abs(row.ratio - 2 / 3) < 0.01));
      const [first, second, third] = state.rows;
      assert.ok(first.x > 0 && second.x < 0 && third.x > 0, 'alternating directions');
      assert.ok(Math.abs(first.x + second.x) < 1 && Math.abs(first.x - third.x) < 1);
      assert.ok(Math.abs(state.opacity - Math.min(1, 0.2 + 4 * progress)) < 0.03);
      if (progress === 0.1) {
        assert.equal(state.tilt, true);
        assert.ok(Math.abs(state.y - (-100)) < 20, 'halfway through the -700 to +500 lift');
      }
      if (progress >= 0.2) {
        assert.ok(Math.abs(state.y - 500) < 5);
        assert.ok(state.rows.every(row => row.left <= 1 && row.right >= state.width - 1), 'full viewport coverage');
        const trailingGap = state.top + state.height - third.bottom;
        assert.ok(trailingGap >= 0 && trailingGap <= 70, 'third row is not clipped or followed by a blank spacer');
      }
      await screenshot(`desktop-scroll-${progress}`);
    }
    const forward = await scrollToProgress(0.4);
    const frames = await evaluate(`(async () => {
      const hero = document.querySelector('.hero-parallax');
      window.scrollTo({top:hero.offsetTop+hero.offsetHeight*0.1,behavior:'instant'});
      const values = [];
      for (let i=0;i<20;i++) {
        await new Promise(requestAnimationFrame);
        values.push(new DOMMatrix(getComputedStyle(document.querySelector('.hero-book-row')).transform).m41);
      }
      return values;
    })()`);
    const backward = await scrollToProgress(0.1);
    assert.ok(backward.rows[0].x < forward.rows[0].x && backward.opacity < forward.opacity);
    assert.ok(frames.some(x => x > backward.rows[0].x + 5 && x < forward.rows[0].x - 5), 'spring interpolates through intermediate frames, rather than snapping');
  });

  for (const [width, height] of [[320, 740], [390, 844], [768, 1024], [1024, 768], [1920, 1080], [2560, 1440]]) {
    await t.test(`responsive animation at ${width}x${height}`, async () => {
      await viewport(width, height);
      await navigate();
      await screenshot(`${width}-start`);
      for (const progress of [0.1, 0.35, 0.8]) {
        const state = await scrollToProgress(progress);
        assert.equal(state.overflow, false);
        assert.ok(state.rows[0].x > 0 && state.rows[1].x < 0);
        if (progress > 0.2) assert.ok(state.rows.every(row => row.left <= 1 && row.right >= state.width - 1));
        await screenshot(`${width}-scroll-${progress}`);
      }
    });
  }

  await t.test('live resize and reduced-motion changes: static, scrollable, no hover lift', async () => {
    await viewport(1440, 900);
    await navigate();
    await scrollToProgress(0.3);
    await viewport(390, 844);
    await delay(800);
    assert.equal((await sample()).overflow, false);
    await viewport(390, 844, true);
    await until(() => evaluate('!!document.querySelector(".hero-parallax--still")'), 'reduced motion');
    await evaluate('window.scrollTo({top:400,behavior:"instant"})');
    await delay(300);
    const result = await evaluate(`(() => {
      const row=document.querySelector('.hero-book-row');
      row.scrollLeft=200;
      return { x: row.scrollLeft, plane: getComputedStyle(document.querySelector('.hero-book-plane')).transform,
        rows: [...document.querySelectorAll('.hero-book-row')].map(r=>getComputedStyle(r).transform),
        focusable: [...document.querySelectorAll('.hero-book a')].every(a=>a.tabIndex===0) };
    })()`);
    assert.ok(result.x > 0);
    assert.equal(result.plane, 'none');
    assert.deepEqual(result.rows, ['none', 'none', 'none']);
    assert.equal(result.focusable, true);
    await evaluate('document.querySelector(".hero-book a").focus()');
    const box = await evaluate('document.querySelector(".hero-book").getBoundingClientRect().toJSON()');
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.max(5, box.x + 50), y: Math.max(70, box.y + 50) });
    await delay(500);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".hero-book")).transform'), 'none');
    assert.equal((await sample()).overflow, false);
    await screenshot('reduced-motion-mobile');
    await viewport(1440, 900, true);
    await navigate();
    await screenshot('reduced-motion-desktop');
  });

  await t.test('API covers, broken-image fallback and unique curated fill', async () => {
    apiOnline = true;
    await viewport(1440, 900);
    await navigate();
    await until(() => evaluate('document.querySelector(".hero-book img")?.currentSrc.includes("portrait.svg")'), 'API cover');
    const images = await evaluate('[...document.querySelectorAll(".hero-book img")].map(i=>({src:i.src,loaded:i.complete&&i.naturalWidth>0}))');
    assert.equal(images.length, 24);
    assert.ok(images[0].src.includes('portrait.svg') && images[0].loaded);
    assert.ok(images[1].src.includes('strategi-seo-terkini') && images[1].loaded);
    assert.ok(images[2].src.includes('landscape.svg') && images[2].loaded, 'valid API image keeps its portrait frame without discarding the source');
    assert.equal(new Set(images.map(i=>i.src)).size, 24, 'matched fallback must not be duplicated in another slot');
    await navigate('/hero-fixture');
    await evaluate(`window.showHero(${JSON.stringify(fixtureContents)})`);
    await until(() => evaluate('document.querySelector(".hero-book img")?.currentSrc.includes("portrait.svg")'), 'initial fixture cover');
    await evaluate(`window.showHero(${JSON.stringify([{ ...fixtureContents[0], cover_url: '/__covers/refreshed.svg' }])})`);
    await until(() => evaluate('document.querySelector(".hero-book img")?.currentSrc.includes("refreshed.svg")'), 'refreshed cover with unchanged id');
  });

  assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
});
