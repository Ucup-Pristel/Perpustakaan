'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const knex = require('knex');
const { isReady } = require('../backend/helpers/readiness');

test('readiness refuses empty, pending, locked and disconnected databases without migrating', async () => {
  const db = knex({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  try {
    assert.equal(await isReady(db), false);
    assert.equal(await db.schema.hasTable('knex_migrations'), false);
    await db.migrate.latest({ directory: path.resolve(__dirname, '../database/migrations') });
    assert.equal(await isReady(db), true);
    await db('knex_migrations_lock').update({ is_locked: 1 });
    assert.equal(await isReady(db), false);
    await db('knex_migrations_lock').update({ is_locked: 0 });
    const migration = await db('knex_migrations').first();
    await db('knex_migrations').where({ id: migration.id }).delete();
    assert.equal(await isReady(db), false);
    await db('knex_migrations').insert(migration);
    assert.equal(await isReady(db), true);
  } finally {
    await db.destroy();
  }
  assert.equal(await isReady(db), false);
});
