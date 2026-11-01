/**
 * ucup-edu-lib :: One-shot Knex migration KHUSUS database staging PostgreSQL
 *
 * Dijalankan manual sebagai container sekali-pakai (lihat infra/README-staging.md):
 *   docker compose ... run --rm api node scripts/migrate-staging.js status
 *   CONFIRM_STAGING_DB=edulib_staging docker compose ... run --rm \
 *     -e CONFIRM_STAGING_DB api node scripts/migrate-staging.js latest
 *
 * API startup TIDAK pernah memanggil script ini.
 *
 * Guard (semua wajib lolos sebelum koneksi dibuka):
 *   - DB_CLIENT=pg
 *   - DB_DATABASE dan DB_USER berakhiran `_staging` (DB produksi `edulib` dan
 *     role admin `edulib_admin` otomatis ditolak)
 *   - `latest`/`unlock` butuh CONFIRM_STAGING_DB yang sama persis dengan DB_DATABASE
 * Setelah konek, current_database()/current_user dicek ulang di server.
 */
'use strict';

const STAGING_RE = /^[a-z0-9_]+_staging$/;

/** Lempar Error kalau env tidak menunjuk ke DB staging. Tanpa I/O. */
function assertStagingTarget(env, command) {
  if (!['status', 'latest', 'unlock'].includes(command)) {
    throw new Error('Perintah: node scripts/migrate-staging.js <status|latest|unlock>');
  }
  if (env.DB_CLIENT !== 'pg') throw new Error('Menolak: DB_CLIENT harus pg.');
  const { DB_DATABASE: database = '', DB_USER: user = '' } = env;
  if (!STAGING_RE.test(database)) {
    throw new Error(`Menolak: DB_DATABASE "${database}" bukan database staging (harus berakhiran _staging).`);
  }
  if (!STAGING_RE.test(user)) {
    throw new Error(`Menolak: DB_USER "${user}" bukan role staging (harus berakhiran _staging).`);
  }
  if (command !== 'status' && env.CONFIRM_STAGING_DB !== database) {
    throw new Error(`Menolak: set CONFIRM_STAGING_DB=${database} untuk menjalankan ${command}.`);
  }
  return { database, user };
}

// assertTarget/tag: dipakai ulang oleh scripts/migrate-prod.js dengan guard produksi.
async function main(argv = process.argv.slice(2), env = process.env, assertTarget = assertStagingTarget, tag = 'migrate-staging') {
  const command = argv[0];
  const expected = assertTarget(env, command);

  const db = require('../backend/models/db');
  try {
    const { rows: [server] } = await db.raw('select current_database() as database, current_user as user');
    if (server.database !== expected.database || server.user !== expected.user) {
      throw new Error(`Menolak: server melaporkan ${server.user}@${server.database}, bukan ${expected.user}@${expected.database}.`);
    }
    console.log(`[${tag}] target: ${server.user}@${server.database}`);

    if (command === 'unlock') {
      await db.migrate.forceFreeMigrationsLock();
      console.log(`[${tag}] lock knex_migrations_lock dilepas`);
    }

    if (command === 'latest') {
      // Knex menjalankan seluruh batch dalam SATU transaksi: kalau satu migration
      // gagal di PostgreSQL, semua DDL batch itu di-rollback.
      const [batch, files] = await db.migrate.latest();
      console.log(files.length ? `[${tag}] batch ${batch}: ${files.join(', ')}` : `[${tag}] sudah up to date`);
    }

    const [done, pending] = await db.migrate.list();
    console.log(`[${tag}] selesai: ${done.length}, pending: ${pending.length}`);
    for (const m of pending) console.log(`  pending: ${m.file}`);
    if (command === 'latest' && pending.length) throw new Error('Masih ada migration pending.');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('[migrate-staging] GAGAL:', err.message); process.exitCode = 1; });
}

module.exports = { assertStagingTarget, main };
