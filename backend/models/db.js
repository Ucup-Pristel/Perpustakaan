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
  // SQLite: FK enforcement OFF secara default DAN per-koneksi, jadi pragma harus
  // dipasang di afterCreate — bukan sekali di startup. Tanpa ini, ON DELETE CASCADE
  // di schema tidak pernah aktif dan baris orphan bisa masuk.
  // WAL: reader tidak memblokir writer (default `delete` bikin 'database is locked'
  // saat baca+tulis bersamaan). busy_timeout: tunggu lock, jangan langsung gagal.
  pool: process.env.DB_CLIENT === 'pg'
    ? { min: 2, max: 10 }
    : {
        min: 1,
        max: 1,
        afterCreate: (conn, done) => {
          conn.run('PRAGMA foreign_keys = ON', (err) => {
            if (err) return done(err, conn);
            conn.run('PRAGMA journal_mode = WAL', (err2) => {
              if (err2) return done(err2, conn);
              conn.run('PRAGMA busy_timeout = 5000', (err3) => done(err3, conn));
            });
          });
        },
      },
  migrations: {
    tableName: 'knex_migrations',
    directory: './database/migrations',
  },
  seeds: {
    directory: './database/seeds',
  },
});

// Schema TIDAK lagi dibuat di sini. Sebelumnya empat blok createTable berjalan
// async saat module dimuat, sementara app.listen() jalan tanpa menunggunya —
// request awal bisa kena tabel yang belum ada, dan bentuk tabel yang dibuat di
// sini berbeda dari database/schema.sql (notes tanpa updated_at/unique, semua
// tanpa FK). Sumber kebenaran sekarang: database/migrations/, dijalankan lewat
// `npm run migrate` sebagai langkah deploy yang wajib.

module.exports = knex;

