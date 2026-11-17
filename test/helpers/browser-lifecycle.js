'use strict';

const { spawn, execFileSync } = require('node:child_process');
const { rm } = require('node:fs/promises');
const { setTimeout: delay } = require('node:timers/promises');

// Linux CI browsers own a detached POSIX group. Never kill other Chrome tests.
function createBrowserLifecycle({ shutdownTimeout = 3000, maxRetries = 5, retryDelay = 100 } = {}) {
  let browser, closed = true, launchError, cleanupPromise;

  function groupRunning() {
    return execFileSync('ps', ['-eo', 'pgid=,stat='], { encoding: 'utf8', timeout: 1000 })
      .trim().split('\n').some(line => {
        const [group, state] = line.trim().split(/\s+/);
        // Zombies are terminated processes; they cannot write to the profile.
        return Number(group) === browser.pid && !/^[ZX]/.test(state);
      });
  }

  async function waitForExit() {
    const deadline = Date.now() + shutdownTimeout;
    do {
      if (closed && (!browser.pid || !groupRunning())) return true;
      await delay(25);
    } while (Date.now() < deadline);
    return false;
  }

  async function closeServer(server) {
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => server.close()),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Timed out closing browser test server')), shutdownTimeout * 3);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function cleanup({ socket, server, directory }) {
    const errors = [];
    let stopped = !browser;
    if (browser) {
      if (socket?.readyState === 1) {
        try { socket.send(JSON.stringify({ id: 0, method: 'Browser.close' })); }
        catch (error) { errors.push(error); }
      }
      // Graceful shutdown first, then bounded escalation of this group only.
      for (const signal of [null, 'SIGTERM', 'SIGKILL']) {
        if (signal && browser.pid) {
          try { process.kill(-browser.pid, signal); }
          catch (error) { if (error.code !== 'ESRCH') errors.push(error); }
        }
        // A failed process query must not prevent the next shutdown signal.
        try { if (await waitForExit()) { stopped = true; break; } }
        catch (error) { errors.push(error); }
      }
      if (!stopped) errors.push(new Error('Chromium process group did not stop; retaining its temporary directory'));
    }
    if (launchError) errors.unshift(launchError);

    // Run each cleanup even if another failed, preserving every error. Node's
    // test runner also retains functional assertion failures from the test body.
    try { socket?.close(); } catch (error) { errors.push(error); }
    let serverClosed = !server;
    if (server) {
      try { await closeServer(server); serverClosed = true; }
      catch (error) { errors.push(error); }
    }
    if (stopped && serverClosed && directory) {
      try { await rm(directory, { recursive: true, force: true, maxRetries, retryDelay }); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, 'Browser test cleanup failed');
  }

  return {
    spawn(command, args, options = {}) {
      if (browser || cleanupPromise) throw new Error('Browser lifecycle can launch only one browser');
      browser = spawn(command, args, { stdio: 'ignore', ...options, detached: true });
      closed = false;
      // Attach immediately, including when startup fails or the root exits
      // before teardown. `exitCode` alone misses signal termination.
      browser.once('error', error => { launchError = error; });
      browser.once('close', () => { closed = true; });
      return browser;
    },
    cleanup(options) {
      return cleanupPromise ??= cleanup(options);
    },
  };
}

module.exports = { createBrowserLifecycle };
