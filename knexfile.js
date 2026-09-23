/**
 * ucup-edu-lib :: Knex CLI config
 * Dipakai oleh `npx knex migrate:*`. Path DB dihitung dari __dirname (bukan cwd)
 * supaya konsisten dengan backend/models/db.js dan kebal dijalankan dari mana saja.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const PROJECT_ROOT = __dirname;

const sqliteConnection = {
  filename: process.env.DB_FILENAME
    ? path.resolve(PROJECT_ROOT, process.env.DB_FILENAME)
    : path.resolve(PROJECT_ROOT, 'database/ucup-edu-lib.db'),
};

const pgConnection = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

const isPg = process.env.DB_CLIENT === 'pg';

module.exports = {
  client: isPg ? 'pg' : 'sqlite3',
  connection: isPg ? pgConnection : sqliteConnection,
  useNullAsDefault: true,
  pool: isPg ? { min: 2, max: 10 } : { min: 1, max: 1 },
  migrations: {
    tableName: 'knex_migrations',
    directory: path.resolve(PROJECT_ROOT, 'database/migrations'),
  },
  seeds: {
    directory: path.resolve(PROJECT_ROOT, 'database/seeds'),
  },
};
