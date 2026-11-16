/**
 * ucup-edu-lib :: Regression test kesiapan migrasi PostgreSQL (sisi SQLite + infra)
 *
 * - backend/models/db.js: migrations/seeds dir absolut dari root project,
 *   jadi db.migrate.* jalan dari cwd mana pun.
 * - scripts/seed-db.js: opt-in `--sample`, tolak production, tolak migration
 *   pending, tolak katalog yang sudah berisi, pakai schema dari migrations.
 * - scripts/create-admin.js: `.returning('id')` tetap benar di SQLite,
 *   user lama hanya dinaikkan role-nya (password tidak ditimpa).
 * - infra staging: tidak ada migration otomatis saat startup, boundary tetap.
 *
 * Semua child process dijalankan dengan cwd = direktori sementara (BUKAN root).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ucup-readiness-'));
test.after(() => fs.rmSync(temp, { recursive: true, force: true }));

const run = (args, env) => spawnSync(process.execPath, args, {
  cwd: temp, encoding: 'utf8',
  env: { ...process.env, DB_CLIENT: 'sqlite3', NODE_ENV: 'development', ...env },
});
const knexFor = (filename) => require('knex')({ client: 'sqlite3', connection: { filename }, useNullAsDefault: true });
const migrate = (filename) => {
  const r = run([path.join(ROOT, 'node_modules/knex/bin/cli.js'), '--knexfile', path.join(ROOT, 'knexfile.js'), 'migrate:latest'], { DB_FILENAME: filename });
  assert.equal(r.status, 0, r.stderr);
};

test('db.js resolves migrations/seeds from project root regardless of cwd', () => {
  const r = run(['-e', `
    const db = require(${JSON.stringify(path.join(ROOT, 'backend/models/db'))});
    console.log(JSON.stringify(db.client.config.migrations.directory));
    console.log(JSON.stringify(db.client.config.seeds.directory));
    db.migrate.list().then(([, pending]) => { console.log(pending.length); return db.destroy(); });
  `], { DB_FILENAME: path.join(temp, 'paths.db') });
  assert.equal(r.status, 0, r.stderr);
  const [migrations, seeds, pending] = r.stdout.trim().split('\n');
  assert.equal(JSON.parse(migrations), path.join(ROOT, 'database/migrations'));
  assert.equal(JSON.parse(seeds), path.join(ROOT, 'database/seeds'));
  assert.equal(Number(pending), fs.readdirSync(path.join(ROOT, 'database/migrations')).length);
});

test('seed-db refuses without --sample and in production, before touching the DB', () => {
  const filename = path.join(temp, 'never.db');
  const seed = path.join(ROOT, 'scripts/seed-db.js');

  const noFlag = run([seed], { DB_FILENAME: filename });
  assert.equal(noFlag.status, 1);
  assert.match(noFlag.stderr, /--sample/);

  const prod = run([seed, '--sample'], { DB_FILENAME: filename, NODE_ENV: 'production' });
  assert.equal(prod.status, 1);
  assert.match(prod.stderr, /NODE_ENV=production/);

  assert.equal(fs.existsSync(filename), false, 'DB tidak boleh dibuka sama sekali');
});

test('seed-db refuses pending migrations, seeds migrated schema once, refuses non-empty catalog', async () => {
  const filename = path.join(temp, 'seed.db');
  const seed = path.join(ROOT, 'scripts/seed-db.js');

  const pending = run([seed, '--sample'], { DB_FILENAME: filename });
  assert.equal(pending.status, 1);
  assert.match(pending.stderr, /migration belum dijalankan/);

  migrate(filename);
  const ok = run([seed, '--sample'], { DB_FILENAME: filename });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /5 fields, 7 sub_fields, 8 contents/);

  const db = knexFor(filename);
  try {
    // Kolom schema dari migration (bukan schema buatan seed) tetap utuh.
    assert.ok(await db.schema.hasColumn('users', 'session_version'));
    assert.equal(await db.schema.hasColumn('contents', 'cover_image_url'), false);
    const orphans = await db('sub_fields').leftJoin('fields', 'fields.id', 'sub_fields.field_id').whereNull('fields.id');
    assert.equal(orphans.length, 0);
    const joined = await db('contents').join('sub_fields', 'sub_fields.id', 'contents.sub_field_id')
      .where('contents.title', 'Clean Code').first('sub_fields.slug');
    assert.equal(joined.slug, 'software-engineering');

    const again = run([seed, '--sample'], { DB_FILENAME: filename });
    assert.equal(again.status, 1);
    assert.match(again.stderr, /sudah berisi/);
    assert.equal((await db('fields').count('* as c').first()).c, 5, 'seed kedua tidak boleh menulis');
  } finally {
    await db.destroy();
  }
});

test('create-admin inserts with returning id on SQLite and only promotes existing users', async () => {
  const filename = path.join(temp, 'admin.db');
  migrate(filename);
  const script = path.join(ROOT, 'scripts/create-admin.js');
  const env = { DB_FILENAME: filename, ADMIN_NAME: 'Admin', ADMIN_PASSWORD: 'secret-pass' };

  const created = run([script], { ...env, ADMIN_EMAIL: 'New@Admin.Test' });
  assert.equal(created.status, 0, created.stderr);
  const db = knexFor(filename);
  try {
    const row = await db('users').where({ email: 'new@admin.test' }).first();
    assert.match(created.stdout, new RegExp(`User admin dibuat \\(id=${row.id}\\)`));
    assert.equal(row.role, 'admin');
    assert.doesNotMatch(created.stdout + created.stderr, /secret-pass/);

    await db('users').insert({ email: 'member@admin.test', password_hash: 'keep-me', full_name: 'M', role: 'member' });
    const promoted = run([script], { ...env, ADMIN_EMAIL: 'member@admin.test' });
    assert.equal(promoted.status, 0, promoted.stderr);
    const member = await db('users').where({ email: 'member@admin.test' }).first();
    assert.equal(member.role, 'admin');
    assert.equal(member.password_hash, 'keep-me');
  } finally {
    await db.destroy();
  }
});

test('staging infra: no auto-migration on startup, isolation boundaries preserved', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'infra/compose.staging.yaml'), 'utf8');
  const dockerfile = fs.readFileSync(path.join(ROOT, 'infra/Dockerfile.api'), 'utf8');

  assert.match(dockerfile, /^CMD \["node", "backend\/server\.js"\]$/m);
  assert.doesNotMatch(compose, /migrat|command:|entrypoint:/i);
  assert.doesNotMatch(compose, /^\s{2}postgres:/m, 'staging tidak boleh mendefinisikan PostgreSQL');
  assert.match(compose, /external: true\n\s+name: edulib_database/);
  assert.equal((compose.match(/read_only: true/g) || []).length, 2);
  assert.match(compose, /"127\.0\.0\.1:18081:80"/);
  assert.equal((compose.match(/^\s+- "[^"]*:\d+:\d+"$/gm) || []).length, 1, 'hanya satu port publish');
  assert.match(compose, /DB_DATABASE: \$\{STAGING_DB_NAME:\?/);
});
