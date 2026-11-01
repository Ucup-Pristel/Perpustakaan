/**
 * ucup-edu-lib :: scripts/migrate-prod.js guard (no DB, no network).
 * Real PostgreSQL behaviour is covered by test/portable-rehearsal.sh.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { assertProdTarget } = require('../scripts/migrate-prod');

const PROD = { DB_CLIENT: 'pg', DB_DATABASE: 'edulib', DB_USER: 'edulib_app' };

test('assertProdTarget: confirmation, staging refusal, identifiers', () => {
  const reject = (env, cmd, re) => assert.throws(() => assertProdTarget(env, cmd), re);
  reject(PROD, 'rollback', /status\|latest\|unlock/);
  reject({ ...PROD, DB_CLIENT: 'sqlite3' }, 'status', /DB_CLIENT harus pg/);
  reject({ ...PROD, DB_DATABASE: 'edulib_staging' }, 'status', /target staging/);
  reject({ ...PROD, DB_USER: 'edulib_staging' }, 'status', /target staging/);
  reject({ ...PROD, DB_DATABASE: 'Edulib;drop' }, 'status', /tidak valid/);
  reject({ ...PROD, DB_USER: undefined }, 'status', /tidak valid/);
  reject(PROD, 'latest', /CONFIRM_PROD_DB=edulib/);
  reject({ ...PROD, CONFIRM_PROD_DB: 'edulib_other' }, 'unlock', /CONFIRM_PROD_DB=edulib/);
  assert.deepEqual(assertProdTarget(PROD, 'status'), { database: 'edulib', user: 'edulib_app' });
  assert.ok(assertProdTarget({ ...PROD, CONFIRM_PROD_DB: 'edulib' }, 'latest'));
});

test('migrate-prod CLI refuses unconfirmed latest before any DB access', () => {
  // Unroutable host: if the guard leaked, the error would be a connection error.
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/migrate-prod.js'), 'latest'], {
    encoding: 'utf8', timeout: 20000, env: { PATH: process.env.PATH, ...PROD, DB_HOST: '192.0.2.1' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /\[migrate-prod\] GAGAL: Menolak: set CONFIRM_PROD_DB=edulib/);
});
