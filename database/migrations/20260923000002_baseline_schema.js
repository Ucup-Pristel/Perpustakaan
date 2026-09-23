/**
 * ucup-edu-lib :: Baseline schema
 *
 * Sumber kebenaran tunggal untuk instalasi BARU. Sebelum ini, tabel dibuat oleh
 * tiga tempat berbeda dengan bentuk berbeda (backend/models/db.js saat startup,
 * database/init.js, scripts/seed-db.js) sehingga hasil instalasi bergantung pada
 * command mana yang dijalankan lebih dulu.
 *
 * Idempoten: setiap tabel dicek hasTable dulu, jadi aman dijalankan pada DB yang
 * sudah berisi data (di sana migration ini jadi no-op).
 *
 * Catatan: tabel anak dibuat langsung dengan ON DELETE CASCADE. Pada DB lama,
 * migration 20260923000001_fk_cascade yang menambahkan CASCADE lewat rebuild.
 * Kolom `cover_image_url` sengaja TIDAK dibuat lagi — kolom itu mati (0 baris
 * terisi pada DB live) dan digantikan `cover_url`.
 */
'use strict';

exports.up = async function up(knex) {
  const isSqlite = knex.client.config.client === 'sqlite3';

  if (!(await knex.schema.hasTable('users'))) {
    await knex.schema.createTable('users', (t) => {
      t.increments('id').primary();
      t.string('email').notNullable().unique();
      t.string('password_hash').notNullable();
      t.string('full_name').notNullable();
      t.string('role').notNullable().defaultTo('member');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    console.log('  [baseline] users dibuat');
  }

  if (!(await knex.schema.hasTable('fields'))) {
    await knex.schema.createTable('fields', (t) => {
      t.increments('id').primary();
      t.string('slug').notNullable().unique();
      t.string('name').notNullable();
      t.text('description');
      t.string('icon');
      t.string('color');
      t.integer('sort_order').defaultTo(0);
      t.boolean('is_active').defaultTo(true);
    });
    console.log('  [baseline] fields dibuat');
  }

  if (!(await knex.schema.hasTable('sub_fields'))) {
    await knex.schema.createTable('sub_fields', (t) => {
      t.increments('id').primary();
      t.integer('field_id').notNullable().references('id').inTable('fields');
      t.string('slug').notNullable().unique();
      t.string('name').notNullable();
      t.text('description');
      t.integer('parent_id');
      t.integer('sort_order').defaultTo(0);
    });
    console.log('  [baseline] sub_fields dibuat');
  }

  if (!(await knex.schema.hasTable('contents'))) {
    await knex.schema.createTable('contents', (t) => {
      t.increments('id').primary();
      t.integer('sub_field_id').references('id').inTable('sub_fields');
      t.string('title').notNullable();
      t.string('author');
      t.text('description');
      t.integer('level');
      t.string('content_type');
      t.string('source_url');
      t.string('file_url');
      t.text('cover_url');
      t.text('tags');
      t.string('language').defaultTo('id');
      t.integer('page_count');
      t.integer('duration');
      t.integer('difficulty_score');
      t.boolean('is_featured').defaultTo(false);
      t.integer('read_count').defaultTo(0);
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    console.log('  [baseline] contents dibuat');
  }

  if (!(await knex.schema.hasTable('content_paths'))) {
    await knex.schema.createTable('content_paths', (t) => {
      t.increments('id').primary();
      t.integer('sub_field_id').references('id').inTable('sub_fields');
      t.integer('from_content_id');
      t.integer('to_content_id');
      t.string('path_type');
    });
    console.log('  [baseline] content_paths dibuat');
  }

  // --- tabel anak: langsung dengan ON DELETE CASCADE ---

  if (!(await knex.schema.hasTable('notes'))) {
    await knex.schema.createTable('notes', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.integer('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
      t.integer('page_number').notNullable();
      t.text('note_text').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
      t.timestamp('updated_at');
      t.unique(['user_id', 'content_id', 'page_number'], { indexName: 'notes_user_content_page_unique' });
    });
    console.log('  [baseline] notes dibuat');
  }

  if (!(await knex.schema.hasTable('reading_progress'))) {
    await knex.schema.createTable('reading_progress', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.integer('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
      t.integer('last_page').notNullable().defaultTo(1);
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['user_id', 'content_id']);
    });
    console.log('  [baseline] reading_progress dibuat');
  }

  if (!(await knex.schema.hasTable('user_progress'))) {
    await knex.schema.createTable('user_progress', (t) => {
      t.increments('id').primary();
      t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
      t.integer('content_id').notNullable().references('id').inTable('contents').onDelete('CASCADE');
      t.integer('last_page_read').notNullable().defaultTo(0);
      t.string('status').notNullable().defaultTo('reading');
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['user_id', 'content_id']);
    });
    console.log('  [baseline] user_progress dibuat');
  }

  // Index untuk query panas: daftar konten per sub-bidang + lookup aktivitas per user.
  if (isSqlite) {
    await knex.raw('CREATE INDEX IF NOT EXISTS contents_sub_field_level_idx ON `contents` (`sub_field_id`, `level`)');
    await knex.raw('CREATE INDEX IF NOT EXISTS notes_user_idx ON `notes` (`user_id`)');
    await knex.raw('CREATE INDEX IF NOT EXISTS reading_progress_user_idx ON `reading_progress` (`user_id`)');
  }
};

exports.down = async function down(knex) {
  // Baseline tidak menghapus tabel berisi data produksi. Rollback schema awal
  // dilakukan manual dari backup, bukan lewat drop otomatis.
  if (knex.client.config.client !== 'sqlite3') return;
  await knex.raw('DROP INDEX IF EXISTS contents_sub_field_level_idx');
  await knex.raw('DROP INDEX IF EXISTS notes_user_idx');
  await knex.raw('DROP INDEX IF EXISTS reading_progress_user_idx');
};
