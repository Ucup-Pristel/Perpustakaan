/**
 * ucup-edu-lib :: Database Connection (Knex.js)
 * Rujuk: docs/TECHNICAL_CONTEXT.md § 10.4.A — Persiapan Fondasi SEKARANG
 * - Gunakan DB_CLIENT & DB_FILENAME dari .env agar migrasi SQLite→PostgreSQL nanti hanya ganti config
 * - useNullAsDefault: true wajib untuk kompatibilitas SQLite → PostgreSQL
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const knex = require('knex')({
  client: process.env.DB_CLIENT || 'sqlite3',
  connection: (() => {
    if (process.env.DB_CLIENT === 'pg') {
      return {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        database: process.env.DB_DATABASE,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      };
    }
    // SQLite — path absolut via __dirname (project root), kebal terhadap CWD.
    // BUG SEBELUMNYA: path.resolve(DB_FILENAME) resolve relatif ke process.cwd(),
    // jadi kalau server dijalankan dari dalam backend/, path relatif di .env
    // ("./database/...") ikut nunjuk ke backend/database/ (DB kosong/beda),
    // bukan ke database/ di root (DB asli berisi tabel fields/contents/dst).
    // Fix: PROJECT_ROOT selalu dihitung dari __dirname, path relatif di
    // DB_FILENAME di-resolve relatif ke PROJECT_ROOT, bukan cwd.
    const PROJECT_ROOT = path.resolve(__dirname, '../..');
    const defaultDb = path.resolve(PROJECT_ROOT, 'database/ucup-edu-lib.db');
    return {
      filename: process.env.DB_FILENAME
        ? path.resolve(PROJECT_ROOT, process.env.DB_FILENAME)
        : defaultDb,
    };
  })(),
  useNullAsDefault: true,
  pool: process.env.DB_CLIENT === 'pg' ? { min: 2, max: 10 } : { min: 1, max: 1 },
  migrations: {
    tableName: 'knex_migrations',
    directory: './database/migrations',
  },
  seeds: {
    directory: './database/seeds',
  },
});

// Pastikan tabel users ada saat startup
knex.schema.hasTable('users').then(exists => {
  if (!exists) {
    return knex.schema.createTable('users', t => {
      t.increments('id').primary();
      t.string('email').notNullable().unique();
      t.string('password_hash').notNullable();
      t.string('full_name').notNullable();
      t.string('role').notNullable().defaultTo('member');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
}).catch(err => console.error('[db] users table init error:', err));

// Pastikan tabel user_progress ada saat startup
knex.schema.hasTable('user_progress').then(exists => {
  if (!exists) {
    return knex.schema.createTable('user_progress', t => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.integer('content_id').notNullable();
      t.integer('last_page_read').notNullable().defaultTo(0);
      t.string('status').notNullable().defaultTo('reading');
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['user_id', 'content_id']);
    });
  }
}).catch(err => console.error('[db] user_progress table init error:', err));

// Pastikan tabel reading_progress ada saat startup
knex.schema.hasTable('reading_progress').then(exists => {
  if (!exists) {
    return knex.schema.createTable('reading_progress', t => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.integer('content_id').notNullable();
      t.integer('last_page').notNullable().defaultTo(1);
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['user_id', 'content_id']);
    });
  }
}).catch(err => console.error('[db] reading_progress table init error:', err));

// Pastikan tabel notes ada saat startup
knex.schema.hasTable('notes').then(exists => {
  if (!exists) {
    return knex.schema.createTable('notes', t => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.integer('content_id').notNullable();
      t.integer('page_number').notNullable();
      t.text('note_text').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
  }
}).catch(err => console.error('[db] notes table init error:', err));

module.exports = knex;

