/**
 * ucup-edu-lib :: FK + ON DELETE CASCADE untuk tabel anak
 *
 * Kondisi sebelum migrasi (diverifikasi pada DB live):
 *   - notes          : TIDAK punya FOREIGN KEY sama sekali
 *   - user_progress  : TIDAK punya FOREIGN KEY sama sekali
 *   - reading_progress: punya FK ke users/contents TAPI tanpa ON DELETE
 *
 * Tanpa CASCADE, menyalakan `PRAGMA foreign_keys = ON` akan membuat
 * DELETE /api/admin/contents/:id gagal untuk konten yang sudah punya
 * notes / progress (diverifikasi: content id 1, 5, 6, 9).
 *
 * SQLite tidak bisa ALTER TABLE ... ADD CONSTRAINT, jadi tabel di-rebuild
 * mengikuti prosedur resmi SQLite: buat tabel baru -> copy -> drop -> rename
 * -> recreate index. Migrasi ini berjalan saat FK masih OFF (default SQLite),
 * jadi drop/rename aman; pragma FK baru dinyalakan di backend/models/db.js.
 */
'use strict';

// Definisi tabel anak: DDL baru (dengan CASCADE), kolom yang dicopy, dan index
// yang harus dibuat ulang setelah rename. `legacy` = DDL tanpa CASCADE untuk down().
const CHILD_TABLES = [
  {
    name: 'notes',
    columns: 'id, user_id, content_id, page_number, note_text, created_at, updated_at',
    ddl: (t) => `CREATE TABLE \`${t}\` (
      \`id\` integer not null primary key autoincrement,
      \`user_id\` integer not null,
      \`content_id\` integer not null,
      \`page_number\` integer not null,
      \`note_text\` text not null,
      \`created_at\` datetime default CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME,
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`content_id\`) REFERENCES \`contents\`(\`id\`) ON DELETE CASCADE
    )`,
    legacyDdl: (t) => `CREATE TABLE \`${t}\` (
      \`id\` integer not null primary key autoincrement,
      \`user_id\` integer not null,
      \`content_id\` integer not null,
      \`page_number\` integer not null,
      \`note_text\` text not null,
      \`created_at\` datetime default CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME
    )`,
    indexes: [
      'CREATE UNIQUE INDEX `notes_user_content_page_unique` ON `notes`(`user_id`, `content_id`, `page_number`)',
    ],
  },
  {
    name: 'reading_progress',
    columns: 'id, user_id, content_id, last_page, updated_at',
    ddl: (t) => `CREATE TABLE \`${t}\` (
      \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
      \`user_id\` INTEGER NOT NULL,
      \`content_id\` INTEGER NOT NULL,
      \`last_page\` INTEGER NOT NULL DEFAULT 1,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(\`user_id\`, \`content_id\`),
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`content_id\`) REFERENCES \`contents\`(\`id\`) ON DELETE CASCADE
    )`,
    legacyDdl: (t) => `CREATE TABLE \`${t}\` (
      \`id\` INTEGER PRIMARY KEY AUTOINCREMENT,
      \`user_id\` INTEGER NOT NULL,
      \`content_id\` INTEGER NOT NULL,
      \`last_page\` INTEGER NOT NULL DEFAULT 1,
      \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(\`user_id\`, \`content_id\`),
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`),
      FOREIGN KEY (\`content_id\`) REFERENCES \`contents\`(\`id\`)
    )`,
    indexes: [], // UNIQUE inline -> autoindex, tidak perlu dibuat ulang
  },
  {
    name: 'user_progress',
    columns: 'id, user_id, content_id, last_page_read, status, updated_at',
    ddl: (t) => `CREATE TABLE \`${t}\` (
      \`id\` integer not null primary key autoincrement,
      \`user_id\` integer not null,
      \`content_id\` integer not null,
      \`last_page_read\` integer not null default '0',
      \`status\` varchar(255) not null default 'reading',
      \`updated_at\` datetime default CURRENT_TIMESTAMP,
      FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE CASCADE,
      FOREIGN KEY (\`content_id\`) REFERENCES \`contents\`(\`id\`) ON DELETE CASCADE
    )`,
    legacyDdl: (t) => `CREATE TABLE \`${t}\` (
      \`id\` integer not null primary key autoincrement,
      \`user_id\` integer not null,
      \`content_id\` integer not null,
      \`last_page_read\` integer not null default '0',
      \`status\` varchar(255) not null default 'reading',
      \`updated_at\` datetime default CURRENT_TIMESTAMP
    )`,
    indexes: [
      'CREATE UNIQUE INDEX `user_progress_user_id_content_id_unique` on `user_progress` (`user_id`, `content_id`)',
    ],
  },
];

// Rebuild satu tabel memakai prosedur SQLite, dengan verifikasi jumlah baris
// sebelum/sesudah copy supaya data hilang terdeteksi dan migrasi di-rollback.
async function rebuild(knex, spec, ddlFor) {
  const { name, columns, indexes } = spec;
  const tmp = `${name}__migrating`;

  // DB baru/kosong: tabel belum ada. Baseline migration (20260923000002) yang
  // membuatnya, sudah lengkap dengan CASCADE, jadi di sini cukup di-skip.
  if (!(await knex.schema.hasTable(name))) return { table: name, rows: 0, skipped: true };

  const before = Number((await knex(name).count('* as c').first()).c);

  await knex.raw(ddlFor(tmp));
  await knex.raw(`INSERT INTO \`${tmp}\` (${columns}) SELECT ${columns} FROM \`${name}\``);

  const copied = Number((await knex(tmp).count('* as c').first()).c);
  if (copied !== before) {
    throw new Error(`[fk_cascade] ${name}: copy mismatch ${before} -> ${copied}, rollback`);
  }

  await knex.raw(`DROP TABLE \`${name}\``);
  await knex.raw(`ALTER TABLE \`${tmp}\` RENAME TO \`${name}\``);
  for (const sql of indexes) await knex.raw(sql);

  const after = Number((await knex(name).count('* as c').first()).c);
  if (after !== before) {
    throw new Error(`[fk_cascade] ${name}: row count drift ${before} -> ${after}, rollback`);
  }
  return { table: name, rows: after };
}

exports.up = async function up(knex) {
  if (knex.client.config.client !== 'sqlite3') return; // Postgres: pakai ALTER TABLE terpisah

  for (const spec of CHILD_TABLES) {
    const res = await rebuild(knex, spec, spec.ddl);
    if (res.skipped) console.log(`  [fk_cascade] ${res.table}: belum ada, dibuat oleh baseline`);
    else console.log(`  [fk_cascade] ${res.table}: rebuilt with ON DELETE CASCADE (${res.rows} baris)`);
  }

  const violations = await knex.raw('PRAGMA foreign_key_check');
  if (Array.isArray(violations) && violations.length) {
    throw new Error(`[fk_cascade] foreign_key_check menemukan ${violations.length} pelanggaran, rollback`);
  }
};

exports.down = async function down(knex) {
  if (knex.client.config.client !== 'sqlite3') return;
  for (const spec of CHILD_TABLES) {
    await rebuild(knex, spec, spec.legacyDdl);
  }
};
