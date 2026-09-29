'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SECRET = 'rst_S3cr3tT0kenValue';
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'frontend/src/lib/appInsights.js'), 'utf8');

// SDK palsu: tidak ada jaringan ke Azure. Meniru pipeline SDK: item melewati
// telemetry initializer sebelum "dikirim" ke globalThis.__ai.sent.
const mockSdk = `export class ApplicationInsights {
  constructor(opts) { this.inits = []; globalThis.__ai.configs.push(opts.config) }
  loadAppInsights() {}
  addTelemetryInitializer(fn) { this.inits.push(fn) }
  emit(item) { if (this.inits.every(fn => fn(item) !== false)) globalThis.__ai.sent.push(JSON.stringify(item)) }
  trackPageView() {
    this.emit({ name: 'Microsoft.ApplicationInsights.PageView', baseType: 'PageviewData',
      baseData: { name: 'Reset', uri: globalThis.__ai.href, refUri: globalThis.__ai.href }, ext: { trace: {} }, tags: [] })
  }
}`;
const toDataUrl = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');

let loadCount = 0;
async function load(env) {
  globalThis.__ai = { configs: [], sent: [], href: `https://edulib.id/reset-password?token=${SECRET}#x` };
  const code = source
    .replace("'@microsoft/applicationinsights-web'", JSON.stringify(toDataUrl(mockSdk)))
    .replaceAll('import.meta.env', JSON.stringify(env))
    + `\n// load ${loadCount++}`; // URL unik supaya modul dievaluasi ulang
  return import(toDataUrl(code));
}

test('no connection string: initialization is a no-op', async () => {
  for (const env of [{}, { VITE_APPLICATIONINSIGHTS_CONNECTION_STRING: '' }]) {
    const m = await load(env);
    assert.equal(m.appInsights, null);
    assert.equal(globalThis.__ai.configs.length, 0);
    assert.equal(globalThis.__ai.sent.length, 0);
  }
});

test('configured: SPA route + promise rejection tracking, no header capture', async () => {
  const m = await load({ VITE_APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=test' });
  assert.ok(m.appInsights);
  const [config] = globalThis.__ai.configs;
  assert.equal(config.connectionString, 'InstrumentationKey=test');
  assert.equal(config.enableAutoRouteTracking, true);
  assert.equal(config.enableUnhandledPromiseRejectionTracking, true);
  assert.equal(config.enableRequestHeaderTracking, false);
  assert.equal(config.enableResponseHeaderTracking, false);
});

test('initial /reset-password?token= page view never emits the token', async () => {
  await load({ VITE_APPLICATIONINSIGHTS_CONNECTION_STRING: 'InstrumentationKey=test' });
  const [pv] = globalThis.__ai.sent;
  assert.ok(pv, 'initial page view emitted');
  assert.equal(JSON.parse(pv).baseData.uri, 'https://edulib.id/reset-password');
  assert.ok(!globalThis.__ai.sent.join('').includes(SECRET));
});

test('URL sanitizer: normal URL kept, query and fragment removed', async () => {
  const { sanitizeTelemetryText: s } = await load({});
  assert.equal(s('https://edulib.id/contents/12'), 'https://edulib.id/contents/12');
  assert.equal(s('https://edulib.id/search?q=karier&page=2'), 'https://edulib.id/search');
  assert.equal(s('https://edulib.id/reader/3#page=10'), 'https://edulib.id/reader/3');
  assert.equal(s(`https://edulib.id/reset-password?token=${SECRET}`), 'https://edulib.id/reset-password');
  assert.equal(s(`/reset-password?token=${SECRET}`), '/reset-password');
  assert.equal(s('Kenapa gagal? Coba lagi'), 'Kenapa gagal? Coba lagi');
  assert.ok(!s(`Error loading token=${SECRET}&x=1`).includes(SECRET));
});

test('dependency, exception and nested fields are sanitized', async () => {
  const { sanitizeTelemetryItem } = await load({});
  const dep = {
    baseType: 'RemoteDependencyData',
    baseData: {
      name: `GET /api/auth/reset?token=${SECRET}`,
      target: `https://api.edulib.id/api/auth/reset?token=${SECRET}`,
      data: `https://api.edulib.id/api/search?q=secret#frag`,
      properties: { HttpMethod: 'GET' },
    },
  };
  const exc = {
    baseType: 'ExceptionData',
    baseData: {
      exceptions: [{ message: `Failed at https://edulib.id/reset-password?token=${SECRET}`, stack: 'at https://edulib.id/assets/index.js:1:2' }],
      properties: { url: `https://edulib.id/reset-password?token=${SECRET}`, errorSrc: `window.onerror@https://edulib.id/x?token=${SECRET}:1:2` },
    },
  };
  assert.equal(sanitizeTelemetryItem(dep), true);
  sanitizeTelemetryItem(exc);
  assert.equal(dep.baseData.name, 'GET /api/auth/reset');
  assert.equal(dep.baseData.target, 'https://api.edulib.id/api/auth/reset');
  assert.equal(dep.baseData.data, 'https://api.edulib.id/api/search');
  assert.equal(exc.baseData.exceptions[0].stack, 'at https://edulib.id/assets/index.js:1:2');
  assert.ok(!JSON.stringify([dep, exc]).includes(SECRET));
  assert.ok(!JSON.stringify(dep).includes('q=secret'));
});

test('no hardcoded Application Insights connection string in repo source', () => {
  const files = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(path.join(root, 'frontend/src'));
  files.push(path.join(root, 'frontend/.env.example'), path.join(root, 'frontend/index.html'),
    path.join(root, '.github/workflows/azure-static-web-apps-black-ocean-00c276c00.yml'));
  const leak = /InstrumentationKey=[0-9a-f-]{8,}|IngestionEndpoint=https|applicationinsights\.azure\.com/i;
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), leak, f);
  assert.match(source, /import\.meta\.env\.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING/);
  assert.match(fs.readFileSync(files.at(-1), 'utf8'),
    /VITE_APPLICATIONINSIGHTS_CONNECTION_STRING: \$\{\{ vars\.VITE_APPLICATIONINSIGHTS_CONNECTION_STRING \}\}/);
});

test('initialized once from entrypoint, not from components', () => {
  const main = fs.readFileSync(path.join(root, 'frontend/src/main.jsx'), 'utf8');
  assert.match(main, /import '\.\/lib\/appInsights'/);
  const app = fs.readFileSync(path.join(root, 'frontend/src/App.jsx'), 'utf8');
  assert.doesNotMatch(app, /appInsights/);
});
