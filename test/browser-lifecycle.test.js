'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const { createBrowserLifecycle } = require('./helpers/browser-lifecycle');

const helperPath = path.resolve(__dirname, 'helpers/browser-lifecycle.js');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForFile(file) {
  for (let i = 0; i < 150; i++) {
    if (fs.existsSync(file)) return;
    await delay(20);
  }
  throw new Error(`Synthetic browser did not start: ${file}`);
}

// A dead orphan can remain a zombie until PID 1 reaps it; it cannot write files.
function live(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !/^[ZX]/.test(stat.slice(stat.lastIndexOf(')') + 2));
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-lifecycle-'));
  const children = [];
  t.after(async () => {
    for (const { browser } of children) {
      try { process.kill(-browser.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    await Promise.all(children.map(({ closed }) => Promise.race([closed, delay(1000)])));
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  });
  const directory = path.join(root, 'profile');
  fs.mkdirSync(directory);
  return { root, directory, track(browser) {
    const closed = new Promise(resolve => browser.once('close', resolve));
    children.push({ browser, closed });
    return closed;
  } };
}

async function browserFamily(t, { ignoreTerm = false } = {}) {
  const fixture = temp(t);
  const ready = path.join(fixture.root, 'ready.json');
  const childCode = `
    const fs = require('node:fs');
    const profile = ${JSON.stringify(fixture.directory)};
    fs.writeFileSync(${JSON.stringify(ready)}, JSON.stringify({ pid: process.pid }));
    setInterval(() => fs.writeFileSync(profile + '/heartbeat', 'still writing'), 10);
    process.on('SIGTERM', () => {
      ${ignoreTerm ? '' : "setTimeout(() => { fs.writeFileSync(profile + '/last-write', 'finished'); process.exit(0); }, 50);"}
    });
  `;
  const parentCode = `
    require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore' });
    process.on('SIGTERM', () => process.exit(0));
    setInterval(() => {}, 100);
  `;
  const lifecycle = createBrowserLifecycle({ shutdownTimeout: 200, retryDelay: 10 });
  const browser = lifecycle.spawn(process.execPath, ['-e', parentCode]);
  const closed = fixture.track(browser);
  await waitForFile(ready);
  const child = JSON.parse(fs.readFileSync(ready, 'utf8')).pid;
  return { ...fixture, browser, child, lifecycle, closed };
}

test('browser cleanup requests graceful close, waits for close and removes the profile', async t => {
  const { root, directory, track } = temp(t);
  const ready = path.join(root, 'ready');
  const lifecycle = createBrowserLifecycle({ shutdownTimeout: 200, retryDelay: 10 });
  const browser = lifecycle.spawn(process.execPath, ['-e', `
    require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready');
    setInterval(() => {}, 100);
  `]);
  track(browser);
  let requested = false, socketClosed = false, serverClosed = false;
  const socket = {
    readyState: 1,
    send(message) {
      assert.equal(JSON.parse(message).method, 'Browser.close');
      requested = true;
      browser.kill('SIGTERM');
    },
    close() { socketClosed = true; },
  };
  await waitForFile(ready);
  await lifecycle.cleanup({ socket, directory, server: { async close() {
    serverClosed = true;
    assert.equal(live(browser.pid), false);
  } } });
  assert.ok(requested && socketClosed && serverClosed);
  assert.equal(fs.existsSync(directory), false);
});

test('browser cleanup waits for a profile-writing child after its parent closes', async t => {
  const { browser, child, lifecycle, directory } = await browserFamily(t);
  let checked = false;
  await lifecycle.cleanup({ directory, socket: {
    readyState: 1,
    send() { browser.kill('SIGTERM'); },
    close() {},
  }, server: { async close() {
    checked = true;
    assert.equal(live(child), false, 'the child must stop before profile removal');
    assert.ok(fs.existsSync(path.join(directory, 'last-write')), 'child completed its final profile write');
  } } });
  assert.ok(checked);
  assert.equal(fs.existsSync(directory), false);
});

test('browser cleanup escalates for a TERM-resistant child whose parent already exited', async t => {
  const { browser, child, lifecycle, directory, closed } = await browserFamily(t, { ignoreTerm: true });
  browser.kill('SIGTERM');
  await closed;
  assert.equal(live(child), true);
  const started = Date.now();
  await lifecycle.cleanup({ directory });
  assert.ok(Date.now() - started < 5000, 'shutdown escalation is bounded');
  assert.equal(live(child), false);
  assert.equal(fs.existsSync(directory), false);
});

test('failed browser spawn is reported while server and directory cleanup still run', async t => {
  const { root, directory } = temp(t);
  const lifecycle = createBrowserLifecycle({ shutdownTimeout: 100 });
  lifecycle.spawn(path.join(root, 'nonexistent-browser'), []);
  // Teardown can race the asynchronous spawn error/close events.
  let serverClosed = false;
  await assert.rejects(lifecycle.cleanup({ directory, server: { async close() { serverClosed = true; } } }),
    error => error.code === 'ENOENT' || error.errors?.some(e => e.code === 'ENOENT'));
  assert.ok(serverClosed);
  assert.equal(fs.existsSync(directory), false);
});

function lifecycleWith(overrides) {
  const module = { exports: {} };
  const initialize = vm.runInThisContext(`(function(require, module) {\n${fs.readFileSync(helperPath, 'utf8')}\n})`, { filename: helperPath });
  initialize(name => overrides[name] || require(name), module);
  return module.exports.createBrowserLifecycle;
}

test('a process-query failure still stops the browser and remains a cleanup error', async t => {
  const { root, directory, track } = temp(t);
  const ready = path.join(root, 'ready');
  const queryError = new Error('process query sentinel');
  const create = lifecycleWith({ 'node:child_process': {
    ...require('node:child_process'), execFileSync() { throw queryError; },
  } });
  const lifecycle = create({ shutdownTimeout: 100 });
  const browser = lifecycle.spawn(process.execPath, ['-e', `
    require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready');
    setInterval(() => {}, 100);
  `]);
  track(browser);
  await waitForFile(ready);
  await assert.rejects(lifecycle.cleanup({ directory }),
    error => error.errors?.includes(queryError));
  assert.equal(live(browser.pid), false, 'failed inspection must not leave a live browser');
  assert.equal(fs.existsSync(directory), true, 'inspection failure retains files');
});

test('exhausted filesystem cleanup retries are reported instead of swallowed', async t => {
  const { directory } = temp(t);
  const removalError = Object.assign(new Error('profile still busy'), { code: 'ENOTEMPTY' });
  const create = lifecycleWith({ 'node:fs/promises': {
    ...require('node:fs/promises'), async rm() { throw removalError; },
  } });
  await assert.rejects(create().cleanup({ directory }), error => error === removalError);
  assert.equal(fs.existsSync(directory), true);
});

test('browser cleanup preserves socket and server errors instead of suppressing them', async t => {
  const { directory } = temp(t);
  const lifecycle = createBrowserLifecycle({ shutdownTimeout: 100 });
  const socketError = new Error('socket cleanup sentinel');
  const serverError = new Error('server cleanup sentinel');
  await assert.rejects(lifecycle.cleanup({ directory,
    socket: { readyState: 3, close() { throw socketError; } },
    server: { async close() { throw serverError; } },
  }), error => error instanceof AggregateError && error.errors.includes(socketError) && error.errors.includes(serverError));
  assert.equal(fs.existsSync(directory), true, 'retain files while the server may still be using them');
});

test('a stuck server has a bounded cleanup failure and repeated cleanup is idempotent', async t => {
  const { directory } = temp(t);
  const lifecycle = createBrowserLifecycle({ shutdownTimeout: 30 });
  let attempts = 0;
  const options = { directory, server: { close() {
    attempts++;
    return new Promise(() => {});
  } } };
  const started = Date.now();
  const first = lifecycle.cleanup(options);
  assert.equal(lifecycle.cleanup(options), first);
  await assert.rejects(first, /Timed out closing browser test server/);
  assert.ok(Date.now() - started < 3000);
  assert.equal(attempts, 1);
  assert.equal(fs.existsSync(directory), true);
});

test('a functional assertion failure remains a failing test after browser cleanup', t => {
  const { root, directory } = temp(t);
  const fixture = path.join(root, 'failure.test.cjs');
  fs.writeFileSync(fixture, `
    const test = require('node:test');
    const assert = require('node:assert/strict');
    const { createBrowserLifecycle } = require(${JSON.stringify(helperPath)});
    test('functional failure sentinel', async t => {
      const lifecycle = createBrowserLifecycle({ shutdownTimeout: 100, retryDelay: 10 });
      const browser = lifecycle.spawn(process.execPath, ['-e', 'setInterval(() => {}, 100)']);
      t.after(() => lifecycle.cleanup({ directory: ${JSON.stringify(directory)} }));
      await new Promise(resolve => browser.once('spawn', resolve));
      assert.fail('intentional functional failure sentinel');
    });
  `);
  const fixtureEnv = { ...process.env };
  delete fixtureEnv.NODE_TEST_CONTEXT; // This is an independent test runner.
  const result = spawnSync(process.execPath, ['--test', fixture], { encoding: 'utf8', timeout: 10000, env: fixtureEnv });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /intentional functional failure sentinel/);
  assert.match(result.stdout, /# fail 1/);
  assert.doesNotMatch(result.stdout, /hookFailed/);
  assert.equal(fs.existsSync(directory), false);
});
