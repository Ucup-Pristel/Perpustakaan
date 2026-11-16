'use strict';

const fs = require('node:fs');
const path = require('node:path');
const migrations = fs.readdirSync(path.resolve(__dirname, '../../database/migrations'))
  .filter(name => name.endsWith('.js')).sort();

// Read-only: probing a fresh database must never initialize Knex metadata or
// apply migrations. Keep liveness separate from this release/schema gate.
async function isReady(db) {
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const applied = (await db('knex_migrations').select('name').timeout(1500))
          .map(row => row.name).sort();
        if (JSON.stringify(applied) !== JSON.stringify(migrations)) return false;
        const locks = await db('knex_migrations_lock').select('is_locked').timeout(1500);
        return locks.length === 1 && Number(locks[0].is_locked) === 0;
      })(),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), 2500); }),
    ]);
  } catch {
    return false; // Do not return database errors, hosts or credentials to clients.
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isReady };
