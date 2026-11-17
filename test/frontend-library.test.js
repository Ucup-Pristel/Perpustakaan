'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBrowserLifecycle } = require('./helpers/browser-lifecycle');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../frontend');
const chrome = process.env.CHROME_BIN || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(fs.existsSync);
let BrowserWebSocket = globalThis.WebSocket;
if (!BrowserWebSocket) {
  try { BrowserWebSocket = require('undici').WebSocket; } catch {}
}
const available = chrome && fs.existsSync(chrome) && BrowserWebSocket && fs.existsSync(path.join(root, 'node_modules/vite/dist/node/index.js'));
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

test('Library shelves: real data, carousel, filters, responsive and failure states', {
  skip: available ? false : 'Needs Chrome, WebSocket (Node 22) and npm ci in frontend', timeout: 180000,
}, async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'library-redesign-'));
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')));

  const fields = [
    { id: 1, name: 'Teknologi', is_active: 1, sort_order: 2 },
    { id: 2, name: 'Manajemen', is_active: 1, sort_order: 1 },
    { id: 3, name: 'Kesehatan', is_active: 1, sort_order: 3 },
    { id: 4, name: 'Pendidikan', is_active: 1, sort_order: 4 },
    { id: 5, name: 'Seni & Kreativitas', is_active: 1, sort_order: 5 },
  ];
  const counts = { 1: 12, 2: 8, 3: 4, 4: 0, 5: 6 };
  const contents = [];
  let nextId = 1;
  for (const field of fields) {
    for (let index = 0; index < counts[field.id]; index += 1) {
      const id = nextId++;
      const type = id === 1 || index % 3 === 0 ? 'pdf' : 'ebook';
      contents.push({
        id,
        field_id: field.id,
        title: `${field.name} ${index + 1}`,
        author: `Penulis ${index + 1}`,
        level: (index % 4) + 1,
        content_type: type,
        file_url: type === 'pdf' ? `/files/${id}.pdf` : null,
        source_url: type === 'ebook' && id !== 3 ? `https://example.test/source/${id}` : null,
        cover_url: id === 2 ? '/covers/broken.svg' : `/covers/book-${id}.svg`,
        created_at: `2026-10-${String(28 - index).padStart(2, '0')} 10:00:00`,
        page_count: null,
        preview: false,
      });
    }
  }

  const state = {
    offline: false,
    empty: false,
    failFields: false,
    failNewest: false,
    failCategoryIds: new Set(),
    apiCalls: 0,
  };
  const json = (res, status, body) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  };

  const server = await createServer({
    root,
    envDir: false,
    cacheDir: path.join(temp, 'vite-cache'),
    define: {
      'import.meta.env.VITE_API_URL': '""',
      'import.meta.env.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING': '""',
    },
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{
      name: 'library-test-fixtures',
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname.startsWith('/api/')) {
            state.apiCalls += 1;
            if (state.offline) return json(res, 503, { status: 'error', message: 'API deliberately offline' });
            if (url.pathname === '/api/fields') {
              if (state.failFields) return json(res, 500, { status: 'error', message: 'Fields failed' });
              return json(res, 200, { status: 'success', data: state.empty ? [] : fields, meta: { total: state.empty ? 0 : fields.length } });
            }
            if (url.pathname === '/api/contents') {
              const fieldId = url.searchParams.get('field_id');
              if (fieldId) {
                if (state.failCategoryIds.has(Number(fieldId))) {
                  return json(res, 500, { status: 'error', message: 'Category failed' });
                }
                const rows = state.empty ? [] : contents.filter(item => item.field_id === Number(fieldId));
                return json(res, 200, { status: 'success', data: rows, meta: { total: rows.length } });
              }
              if (state.failNewest) return json(res, 500, { status: 'error', message: 'Newest failed' });
              const rows = state.empty ? [] : contents;
              return json(res, 200, { status: 'success', data: rows, meta: { total: rows.length } });
            }
            const detail = url.pathname.match(/^\/api\/contents\/(\d+)$/);
            if (detail) {
              const item = contents.find(row => row.id === Number(detail[1]));
              if (item) return json(res, 200, { status: 'success', data: item, meta: {} });
            }
            if (url.pathname === '/api/search') {
              const q = url.searchParams.get('q') || '';
              return json(res, 200, { status: 'success', data: contents.filter(item => item.title.toLowerCase().includes(q.toLowerCase())).slice(0, 2), meta: {} });
            }
            return json(res, 404, { status: 'error', message: 'Not mocked' });
          }
          if (url.pathname.startsWith('/covers/')) {
            if (url.pathname.includes('broken')) { res.statusCode = 404; return res.end(); }
            res.setHeader('Content-Type', 'image/svg+xml');
            return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="100%" height="100%" fill="#c65d28"/><text x="40" y="80" fill="#faf7f1" font-size="32">Edulib</text></svg>`);
          }
          if (url.pathname.startsWith('/files/')) { res.statusCode = 404; return res.end(); }
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
  socket = new BrowserWebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
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
  const screenshot = async name => {
    if (!process.env.LIBRARY_ARTIFACT_DIR) return;
    fs.mkdirSync(process.env.LIBRARY_ARTIFACT_DIR, { recursive: true });
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.LIBRARY_ARTIFACT_DIR, `${name}.png`), Buffer.from(shot.data, 'base64'));
  };
  const navigate = async (route = '/library') => {
    await cdp('Page.navigate', { url: origin + route });
    await until(() => evaluate('document.readyState === "complete" && !!document.querySelector("main")'), `main at ${route}`);
    await delay(500);
  };
  const sample = () => evaluate(`(() => {
    const shelves = [...document.querySelectorAll('[data-shelf]')].map(shelf => {
      const viewport = shelf.querySelector('[data-carousel-viewport]');
      const frame = viewport.getBoundingClientRect();
      const cards = [...shelf.querySelectorAll('[data-book-card]')];
      const boxes = cards.map(card => card.getBoundingClientRect());
      return {
        title: shelf.dataset.shelf,
        count: cards.length,
        visible: boxes.filter(box => box.right > frame.left && box.left < frame.right && box.bottom > 0 && box.top < innerHeight).length,
        transform: getComputedStyle(viewport.firstElementChild).transform,
      };
    });
    const pills = document.querySelector('[aria-label="Filter kategori koleksi"]');
    return {
      width: document.documentElement.clientWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      title: document.querySelector('h1')?.textContent?.trim(),
      shelves,
      pills: pills ? [...pills.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), pressed: button.getAttribute('aria-pressed') })) : [],
      pillsOverflow: pills ? pills.scrollWidth > pills.clientWidth + 1 : false,
    };
  })()`);
  const shelfTransform = title => evaluate(`(() => {
    const shelf = document.querySelector('[data-shelf=${JSON.stringify(title)}]');
    return getComputedStyle(shelf.querySelector('[data-carousel-viewport]').firstElementChild).transform;
  })()`);
  const clickPill = text => evaluate(`(() => {
    const button = [...document.querySelectorAll('[aria-label="Filter kategori koleksi"] button')].find(item => item.textContent.trim() === ${JSON.stringify(text)});
    button?.click();
    return Boolean(button);
  })()`);

  await t.test('desktop: compact shelves, overflow-free layout and independent controls', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    const first = await sample();
    assert.equal(first.title, 'Jelajahi dunia pengetahuan.');
    assert.equal(first.overflow, false);
    assert.ok(first.pills.length >= 6);
    assert.equal(first.pills[0].text, 'Semua');
    assert.equal(first.pills[0].pressed, 'true');
    assert.equal(first.shelves[0].title, 'Baru ditambahkan');
    assert.ok(first.shelves.some(shelf => shelf.title === 'Teknologi'));
    assert.ok(first.shelves[0].count > 8);
    assert.ok(first.shelves[0].visible >= 6 && first.shelves[0].visible <= 8, `visible covers: ${first.shelves[0].visible}`);
    await screenshot('desktop-library');

    const beforeFirst = await shelfTransform('Baru ditambahkan');
    const beforeTech = await shelfTransform('Teknologi');
    const clicked = await evaluate(`(() => {
      const shelf = document.querySelector('[data-shelf="Baru ditambahkan"]');
      const button = shelf.querySelector('button[aria-label="Geser ke kanan"]');
      button?.click();
      return Boolean(button);
    })()`);
    assert.equal(clicked, true);
    await delay(700);
    const afterFirst = await shelfTransform('Baru ditambahkan');
    const afterTech = await shelfTransform('Teknologi');
    assert.notEqual(afterFirst, beforeFirst, 'first shelf moved');
    assert.equal(afterTech, beforeTech, 'shelves keep independent positions');
    await screenshot('desktop-library-moved');

    const wheelBefore = await shelfTransform('Teknologi');
    const wheelResult = await evaluate(`(() => {
      const shelf = document.querySelector('[data-shelf="Teknologi"]');
      const viewport = shelf.querySelector('[data-carousel-viewport]');
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, deltaY: 8, bubbles: true, cancelable: true }));
      return true;
    })()`);
    assert.equal(wheelResult, true);
    await delay(700);
    const wheelAfter = await shelfTransform('Teknologi');
    assert.notEqual(wheelAfter, wheelBefore, 'horizontal wheel gesture moves the shelf');
    assert.equal((await sample()).overflow, false);

    const pdfHref = await evaluate('document.querySelector("[data-book-card=\\"1\\"]")?.getAttribute("href")');
    assert.equal(pdfHref, '/read/1');
    await evaluate('document.querySelector("[data-book-card=\\"1\\"]").click()');
    await until(() => evaluate('location.pathname === "/read/1"'), 'reader navigation');
    await navigate();
  });

  await t.test('pointer drag moves a shelf without following a book link', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    const before = await shelfTransform('Teknologi');
    const box = await evaluate(`(() => {
      const shelf = document.querySelector('[data-shelf="Teknologi"]');
      const rect = shelf.querySelector('[data-carousel-viewport]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    const y = Math.round(box.y + Math.min(180, box.height * 0.35));
    const startX = Math.round(box.x + box.width * 0.7);
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y, button: 'left', clickCount: 1 });
    for (let step = 1; step <= 12; step += 1) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: startX - step * 14, y, button: 'left', buttons: 1 });
      await delay(16);
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: startX - 168, y, button: 'left', clickCount: 1 });
    await delay(700);
    assert.equal(await evaluate('location.pathname'), '/library', 'drag does not follow a cover link');
    assert.notEqual(await shelfTransform('Teknologi'), before, 'mouse drag moves the shelf');
    assert.equal((await sample()).overflow, false);
  });

  await t.test('live resize and tablet update shelf geometry without reloading', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    await viewport(768, 1024);
    await delay(700);
    const tablet = await sample();
    assert.equal(tablet.overflow, false);
    assert.ok(tablet.shelves[0].visible >= 3 && tablet.shelves[0].visible <= 6, `tablet visible: ${tablet.shelves[0].visible}`);
    assert.ok(await evaluate('!!document.querySelector("[data-shelf=\\"Baru ditambahkan\\"] button[aria-label=\\"Geser ke kanan\\"]")'));
    await screenshot('tablet-library');
    const pillsScroll = () => evaluate(`document.querySelector('[aria-label="Filter kategori koleksi"]').scrollLeft`);
    // At 768px the fixture categories can all fit, so no arrow is required.
    // Keep the tablet geometry checks above, then exercise actual overflow.
    await viewport(640, 1024);
    await until(async () => (await sample()).pillsOverflow, 'category strip overflows at the narrower viewport');
    await until(() => evaluate(`!!document.querySelector('button[aria-label="Geser kategori ke kanan"]')`), 'category overflow control');
    const pillsBefore = await pillsScroll();
    await evaluate(`document.querySelector('button[aria-label="Geser kategori ke kanan"]').click()`);
    await delay(700);
    const pillsRight = await pillsScroll();
    assert.ok(pillsRight > pillsBefore, 'category overflow arrow scrolls the strip');
    await until(() => evaluate('!document.querySelector(\'button[aria-label="Geser kategori ke kiri"]\').disabled'), 'left pill arrow enabled');
    await evaluate(`document.querySelector('button[aria-label="Geser kategori ke kiri"]').click()`);
    await delay(700);
    assert.ok(await pillsScroll() < pillsRight, 'category left arrow scrolls back');
    await viewport(390, 844);
    await delay(700);
    const small = await sample();
    assert.equal(small.overflow, false);
    assert.ok(small.shelves[0].visible >= 2 && small.shelves[0].visible <= 3, `live resize visible: ${small.shelves[0].visible}`);
    await viewport(1440, 900);
    await delay(500);
    await navigate();
  });

  await t.test('category pills filter shelves and expose honest empty states', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    const pillLabels = (await sample()).pills.map(pill => pill.text);
    const focusedPill = await evaluate(`(() => {
      const buttons = [...document.querySelectorAll('[aria-label="Filter kategori koleksi"] button')];
      buttons[0].focus();
      buttons[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      return document.activeElement?.textContent.trim();
    })()`);
    assert.equal(focusedPill, pillLabels[1], 'arrow key moves pill focus');
    assert.equal(await clickPill('Kesehatan'), true);
    await until(() => evaluate('document.querySelectorAll("[data-shelf]").length === 1'), 'one filtered shelf');
    const filtered = await sample();
    assert.deepEqual(filtered.shelves.map(shelf => shelf.title), ['Kesehatan']);
    assert.equal(filtered.pills.find(pill => pill.text === 'Kesehatan').pressed, 'true');
    assert.equal(filtered.pills.find(pill => pill.text === 'Semua').pressed, 'false');
    await evaluate('document.activeElement.blur()');
    await delay(700);
    await screenshot('desktop-library-category');

    assert.equal(await clickPill('Pendidikan'), true);
    await until(() => evaluate('document.body.textContent.includes("Belum ada materi di kategori ini.")'), 'empty category state');
    assert.equal((await sample()).shelves.length, 0);
    assert.equal(await clickPill('Semua'), true);
    await until(() => evaluate('document.querySelectorAll("[data-shelf]").length > 2'), 'all shelves restored');
  });

  await t.test('field links and career route preserve catalog navigation', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    await evaluate('document.querySelector("[data-shelf=\\"Kesehatan\\"] a[href=\\"/field/3\\"]").click()');
    await until(() => evaluate('location.pathname === "/field/3"'), 'field navigation');
    const back = await evaluate('document.querySelector("a[href=\\"/karier\\"]")?.textContent.trim()');
    assert.match(back || '', /karier/i);
    await navigate('/karier');
    await until(() => evaluate('document.body.textContent.includes("Pohon Minat & Karier")'), 'career page');
    assert.equal(await evaluate('document.querySelectorAll("header").length'), 1, 'single navbar');
    await navigate('/library');
  });

  await t.test('broken covers fall back, unavailable books stay non-clickable', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    await until(() => evaluate('!!document.querySelector("[data-book-card=\\"2\\"] [data-cover-fallback]")'), 'broken cover fallback');
    const unavailable = await evaluate('(() => { const card = document.querySelector("[data-book-card=\\"3\\"]"); return { disabled: card.getAttribute("aria-disabled"), href: card.getAttribute("href") }; })()');
    assert.equal(unavailable.disabled, 'true');
    assert.equal(unavailable.href, null);
    const external = await evaluate('(() => { const card = document.querySelector("[data-book-card=\\"5\\"]"); return { href: card.getAttribute("href"), target: card.getAttribute("target"), rel: card.getAttribute("rel") }; })()');
    assert.equal(external.href, 'https://example.test/source/5');
    assert.equal(external.target, '_blank');
    assert.match(external.rel, /noopener/);
  });

  await t.test('empty, partial-failure and offline API states are truthful', async () => {
    await viewport(1440, 900);
    state.empty = true;
    await navigate();
    await until(() => evaluate('document.body.textContent.includes("Belum ada koleksi.")'), 'empty collection');
    assert.equal((await sample()).shelves.length, 0);
    assert.equal(await evaluate('document.querySelectorAll("[data-book-card]").length'), 0);
    state.empty = false;

    state.failCategoryIds = new Set([2]);
    await navigate();
    await until(() => evaluate('document.body.textContent.includes("1 kategori gagal dimuat: Manajemen.")'), 'partial category warning');
    assert.ok((await sample()).shelves.some(shelf => shelf.title === 'Teknologi'));
    assert.ok((await sample()).shelves.every(shelf => shelf.title !== 'Manajemen'));
    state.failCategoryIds.clear();

    state.offline = true;
    await navigate();
    await until(() => evaluate('document.body.textContent.includes("Koleksi tidak dapat dimuat.")'), 'offline error state');
    assert.equal(await evaluate('document.querySelectorAll("[data-book-card]").length'), 0);
    assert.ok(await evaluate('document.body.textContent.includes("API deliberately offline")'));
    state.offline = false;
  });

  await t.test('development preview is opt-in and never opens fake book ids', async () => {
    const callsBefore = state.apiCalls;
    await viewport(1440, 900);
    await navigate('/library?preview=1');
    await until(() => evaluate('document.body.textContent.includes("Mode pratinjau pengembangan")'), 'preview banner');
    assert.equal(state.apiCalls, callsBefore, 'preview loads without API requests');
    assert.ok(await evaluate('document.querySelectorAll("[data-book-card]").length > 0'));
    assert.equal(await evaluate('document.querySelectorAll("a[data-book-card]").length'), 0);
    assert.equal(await evaluate('document.querySelectorAll("[data-shelf] a").length'), 0, 'preview shelves avoid fake field links');
    const previewSample = await sample();
    assert.equal(previewSample.overflow, false);
    assert.equal(previewSample.shelves[0].title, 'Contoh koleksi');
    await screenshot('preview-desktop-library');
    await viewport(390, 844);
    await navigate('/library?preview=1');
    await until(() => evaluate('document.body.textContent.includes("Mode pratinjau pengembangan")'), 'preview mobile banner');
    await screenshot('preview-mobile-library');
  });

  await t.test('mobile 390 and 320: fewer covers, search focus and pills overflow', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(390, 844);
    await navigate();
    let mobile = await sample();
    assert.equal(mobile.overflow, false);
    assert.ok(mobile.shelves[0].visible >= 2 && mobile.shelves[0].visible <= 3, `390 visible: ${mobile.shelves[0].visible}`);
    assert.equal(mobile.pillsOverflow, true);
    const swipeBefore = await shelfTransform('Baru ditambahkan');
    const swipeBox = await evaluate(`(() => {
      const rect = document.querySelector('[data-shelf="Baru ditambahkan"] [data-carousel-viewport]').getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    })()`);
    const swipeY = Math.round(swipeBox.y + Math.min(150, swipeBox.height * 0.35));
    const swipeStart = Math.round(swipeBox.x + swipeBox.width * 0.75);
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: swipeStart, y: swipeY, id: 1 }] });
    for (let step = 1; step <= 8; step += 1) {
      await cdp('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: swipeStart - step * 18, y: swipeY, id: 1 }] });
      await delay(16);
    }
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(700);
    await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
    assert.notEqual(await shelfTransform('Baru ditambahkan'), swipeBefore, 'touch swipe moves the shelf');
    assert.equal(await evaluate('location.pathname'), '/library');
    const searchOpened = await evaluate(`(() => {
      document.querySelector('button[aria-label="Buka pencarian"]')?.click();
      return true;
    })()`);
    assert.equal(searchOpened, true);
    await delay(100);
    const focus = await evaluate('document.activeElement?.getAttribute("aria-label")');
    assert.equal(focus, 'Cari buku atau penulis');
    const activeVisible = await evaluate('document.activeElement.offsetParent !== null');
    assert.equal(activeVisible, true);
    const pillRight = await evaluate('!!document.querySelector("button[aria-label=\\"Geser kategori ke kanan\\"]")');
    assert.equal(pillRight, true);
    await screenshot('mobile-library');

    await viewport(320, 740);
    await navigate();
    mobile = await sample();
    assert.equal(mobile.overflow, false);
    assert.ok(mobile.shelves[0].visible >= 2 && mobile.shelves[0].visible <= 3, `320 visible: ${mobile.shelves[0].visible}`);
    await screenshot('mobile-320-library');
  });

  await t.test('desktop 1920 and reduced motion keep controls usable', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1920, 1080);
    await navigate();
    const wide = await sample();
    assert.equal(wide.overflow, false);
    assert.ok(wide.shelves[0].visible >= 6 && wide.shelves[0].visible <= 8, `1920 visible: ${wide.shelves[0].visible}`);
    await screenshot('desktop-1920-library');

    await viewport(1440, 900, true);
    await navigate();
    const before = await shelfTransform('Baru ditambahkan');
    await evaluate('document.querySelector("[data-shelf=\\"Baru ditambahkan\\"] button[aria-label=\\"Geser ke kanan\\"]").click()');
    await delay(200);
    const after = await shelfTransform('Baru ditambahkan');
    assert.notEqual(after, before, 'instant controls still navigate');
    assert.equal((await sample()).overflow, false);
  });

  await t.test('navbar keeps real search/account flows and career route', async () => {
    state.offline = false; state.empty = false; state.failFields = false; state.failNewest = false; state.failCategoryIds.clear();
    await viewport(1440, 900);
    await navigate();
    assert.equal(await evaluate('!!document.querySelector("nav a[href=\\"/karier\\"]")'), true);
    const loginHref = await evaluate('document.querySelector("header a[href=\\"/login\\"]")?.getAttribute("href")');
    assert.equal(loginHref, '/login');

    await evaluate(`(() => {
      const input = document.querySelector('form[role="search"] input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'Teknologi');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await delay(100);
    await evaluate('document.querySelector("form[role=\\"search\\"]").requestSubmit()');
    await until(() => evaluate('location.pathname === "/search" && location.search.includes("q=Teknologi")'), 'search navigation');

    await evaluate(`localStorage.setItem('token', 'test-token'); localStorage.setItem('user', JSON.stringify({ full_name: 'Pengguna Uji', email: 'uji@example.test', role: 'member' }))`);
    await navigate('/library');
    const account = await evaluate('(() => { const button = document.querySelector("button[aria-label=\\"Menu akun\\"]"); return button ? { exists: true, text: button.textContent.trim() } : { exists: false }; })()');
    assert.equal(account.exists, true);
    assert.match(account.text, /Pengguna Uji/);
    await evaluate('document.querySelector("button[aria-label=\\"Menu akun\\"]").click()');
    await until(() => evaluate('!!document.querySelector("[role=\\"menu\\"]")'), 'account menu');
    assert.ok(await evaluate('document.body.textContent.includes("Dashboard")'));
    await evaluate(`localStorage.removeItem('token'); localStorage.removeItem('user')`);
  });

  assert.deepEqual(exceptions, [], 'no uncaught browser exceptions');
});
