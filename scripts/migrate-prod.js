/**
 * ucup-edu-lib :: One-shot Knex migration for the portable PostgreSQL stack
 * (infra/compose.prod.yaml). Run manually in a throwaway container:
 *   $DC run --rm api node scripts/migrate-prod.js status
 *   $DC run --rm -e CONFIRM_PROD_DB=<APP_DB_NAME> api node scripts/migrate-prod.js latest
 *
 * API startup NEVER calls this. Guards (before any connection):
 *   - DB_CLIENT=pg, DB_DATABASE/DB_USER are plain identifiers
 *   - *_staging targets refused (use scripts/migrate-staging.js)
 *   - `latest`/`unlock` need CONFIRM_PROD_DB exactly equal to DB_DATABASE
 * After connecting, current_database()/current_user are re-checked (shared main).
 */
'use strict';

const { main } = require('./migrate-staging');

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

function assertProdTarget(env, command) {
  if (!['status', 'latest', 'unlock'].includes(command)) {
    throw new Error('Perintah: node scripts/migrate-prod.js <status|latest|unlock>');
  }
  if (env.DB_CLIENT !== 'pg') throw new Error('Menolak: DB_CLIENT harus pg.');
  const { DB_DATABASE: database = '', DB_USER: user = '' } = env;
  if (!IDENT_RE.test(database)) throw new Error(`Menolak: DB_DATABASE "${database}" tidak valid.`);
  if (!IDENT_RE.test(user)) throw new Error(`Menolak: DB_USER "${user}" tidak valid.`);
  if (database.endsWith('_staging') || user.endsWith('_staging')) {
    throw new Error('Menolak: target staging, pakai scripts/migrate-staging.js.');
  }
  if (command !== 'status' && env.CONFIRM_PROD_DB !== database) {
    throw new Error(`Menolak: set CONFIRM_PROD_DB=${database} untuk menjalankan ${command}.`);
  }
  return { database, user };
}

if (require.main === module) {
  main(process.argv.slice(2), process.env, assertProdTarget, 'migrate-prod')
    .catch((err) => { console.error('[migrate-prod] GAGAL:', err.message); process.exitCode = 1; });
}

module.exports = { assertProdTarget };
