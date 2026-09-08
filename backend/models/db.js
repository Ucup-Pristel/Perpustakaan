/**
 * ucup-edu-lib :: Database Connection (Knex.js)
 * Rujuk: docs/TECHNICAL_CONTEXT.md § 10.4.A — Persiapan Fondasi SEKARANG
 * - Gunakan DB_CLIENT & DB_FILENAME dari .env agar migrasi SQLite→PostgreSQL nanti hanya ganti config
 * - useNullAsDefault: true wajib untuk kompatibilitas SQLite → PostgreSQL
 */

require('dotenv').config();

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
    // SQLite (development / Fase 1-2)
    return {
      filename: process.env.DB_FILENAME || './database/ucup-edu-lib.db',
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

module.exports = knex;
