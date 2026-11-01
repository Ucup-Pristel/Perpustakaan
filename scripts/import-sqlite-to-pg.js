/**
 * ucup-edu-lib :: Importer data SQLite -> PostgreSQL staging (offline, sekali jalan)
 *
 *   node scripts/import-sqlite-to-pg.js --source <snapshot.db>            # dry-run (default)
 *   CONFIRM_IMPORT_DB=edulib_staging \
 *     node scripts/import-sqlite-to-pg.js --source <snapshot.db> --apply
 *
 * Operator: infra/README-staging.md § 8. Koneksi target dari env DB_* (tanpa .env).
 *
 * Jaminan:
 *   - Source dibuka `mode=ro`; snapshot WAL / ada -wal / -journal ditolak. SHA-256
 *     source dicek sebelum dibaca dan sekali lagi DI DALAM transaksi sebelum
 *     COMMIT (beda -> ROLLBACK). Bukan jaminan mutlak: perubahan setelah cek
 *     terakhir, atau ubah-lalu-kembalikan, tidak terdeteksi. Snapshot tetap wajib
 *     read-only (0440, mount :ro).
 *   - Guard staging sama dengan migrate-staging.js (DB/role `*_staging`), plus
 *     CONFIRM_IMPORT_DB untuk --apply, plus identitas server dicek ulang.
 *   - Target harus sudah dimigrasi penuh dan SEMUA tabel aplikasi kosong. Tidak
 *     ada mode timpa/merge.
 *   - Dry-run = transaksi READ ONLY. Apply = satu transaksi (LOCK, insert, RESTART
 *     sequence, verifikasi); error apa pun -> ROLLBACK total. `ALTER SEQUENCE
 *     RESTART` dipakai, bukan setval(), karena setval() tidak ikut di-rollback.
 *   - Baris tidak valid menghentikan import (tidak pernah di-skip). Pesan error
 *     hanya menyebut tabel/id/kolom, bukan nilai (hash password tidak bocor).
 *   - knex_migrations*, sqlite_sequence tidak diimpor.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const { pathToFileURL } = require('node:url');
const knexFactory = require('knex');
const { assertStagingTarget } = require('./migrate-staging');

const MIGRATIONS_DIR = path.resolve(__dirname, '../database/migrations');
// Urutan dependensi FK (parent dulu). Dicek ulang terhadap FK target saat jalan.
const TABLES = [
  'users', 'fields', 'sub_fields', 'contents', 'content_paths',
  'notes', 'reading_progress', 'user_progress', 'password_reset_tokens',
];
const SKIP = new Set(['knex_migrations', 'knex_migrations_lock', 'sqlite_sequence']);
const CHUNK = 500;
const INT_MAX = 2147483647;
// Angka timestamp = epoch milidetik (cara node-sqlite3 menyimpan Date). Di luar
// 2000..2100 (mis. epoch detik) ditolak, bukan ditebak.
const MS_MIN = Date.UTC(2000, 0, 1);
const MS_MAX = Date.UTC(2100, 0, 1);
const TS_RE = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;

const log = (msg) => console.log(`[import] ${msg}`);
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function toTimestamp(v) {
  if (typeof v === 'number') {
    if (!Number.isInteger(v) || v < MS_MIN || v > MS_MAX) throw new Error('angka bukan epoch milidetik 2000..2100');
    return new Date(v).toISOString();
  }
  const m = typeof v === 'string' && TS_RE.exec(v);
  if (!m) throw new Error('format timestamp tidak dikenal');
  const [, date, time = '00:00:00', frac = '', rawZone] = m;
  // Tanpa zona = UTC: CURRENT_TIMESTAMP SQLite selalu UTC.
  const zone = !rawZone || rawZone === 'Z' ? 'Z' : rawZone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  // Tolak tanggal/jam yang "digulung" JS (2026-02-31 -> 03-03, 24:00 -> besok).
  const probe = new Date(`${date}T${time}Z`);
  if (Number.isNaN(probe.getTime()) || probe.toISOString().slice(0, 19) !== `${date}T${time}`) {
    throw new Error('timestamp tidak valid');
  }
  if (!/^(Z|[+-](0\d|1[0-4]):[0-5]\d)$/.test(zone)) throw new Error('zona waktu tidak valid');
  return `${date}T${time}${frac}${zone}`; // presisi asli (mikrodetik) diteruskan ke PostgreSQL
}

/** Konversi satu nilai SQLite ke tipe kolom target. Lempar Error kalau tidak aman. */
function convert(value, col) {
  if (value === null || value === undefined) {
    if (!col.nullable) throw new Error('NULL pada kolom NOT NULL');
    return null;
  }
  switch (col.type) {
    case 'boolean':
      if (value === 0 || value === 1) return value === 1;
      throw new Error('boolean harus 0/1');
    case 'integer':
      if (!Number.isInteger(value) || Math.abs(value) > INT_MAX) throw new Error('bukan integer 32-bit');
      return value;
    case 'timestamp with time zone':
      return toTimestamp(value);
    case 'text':
    case 'character varying':
      if (typeof value !== 'string') throw new Error(`bukan teks (${Buffer.isBuffer(value) ? 'blob' : typeof value})`);
      if (col.maxLength && [...value].length > col.maxLength) throw new Error(`lebih dari ${col.maxLength} karakter`);
      return value;
    default:
      throw new Error(`tipe target ${col.type} belum didukung importer`);
  }
}

/** Cek file source sebelum dibuka. Tanpa tulis apa pun. */
function checkSourceFile(file) {
  const abs = path.resolve(file);
  const header = Buffer.alloc(100);
  const fd = fs.openSync(abs, 'r');
  try { fs.readSync(fd, header, 0, 100, 0); } finally { fs.closeSync(fd); }
  if (header.toString('latin1', 0, 16) !== 'SQLite format 3\0') throw new Error(`Menolak: ${abs} bukan file SQLite.`);
  // Byte 18/19 = 2 -> WAL. Read-only + WAL butuh -shm yang bisa ditulis, dan
  // isi -wal yang belum di-checkpoint bisa terlewat. Wajib snapshot non-WAL.
  if (header[18] === 2 || header[19] === 2) {
    throw new Error(`Menolak: source mode WAL. Pada SALINAN (bukan DB live): sqlite3 ${abs} 'PRAGMA journal_mode=DELETE;'`);
  }
  for (const suffix of ['-wal', '-journal']) {
    if (fs.existsSync(abs + suffix)) throw new Error(`Menolak: ${abs}${suffix} ada; source harus snapshot tertutup.`);
  }
  return abs;
}

/** Integritas source + baca sqlite_sequence. */
async function inspectSource(src) {
  const integrity = await src.raw('PRAGMA integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Menolak: PRAGMA integrity_check source gagal.');
  const fkViolations = await src.raw('PRAGMA foreign_key_check');
  if (fkViolations.length) {
    const sample = fkViolations.slice(0, 5).map((v) => `${v.table} rowid=${v.rowid} -> ${v.parent}`).join(', ');
    throw new Error(`Menolak: foreign_key_check source menemukan ${fkViolations.length} pelanggaran (${sample}).`);
  }
  const names = await src('sqlite_master').where({ type: 'table' }).pluck('name');
  const tables = names.filter((n) => !SKIP.has(n) && !n.startsWith('sqlite_')).sort();
  const expected = [...TABLES].sort();
  if (tables.join() !== expected.join()) {
    throw new Error(`Menolak: tabel source [${tables}] != tabel aplikasi [${expected}]. Migrasikan SALINAN source ke versi terbaru dulu.`);
  }
  const seqs = new Map();
  if (names.includes('sqlite_sequence')) {
    for (const { name, seq } of await src('sqlite_sequence').select('name', 'seq')) seqs.set(name, Number(seq));
  }
  return { seqs };
}

/** Skema target: kolom per tabel, FK, dan sequence id. */
async function inspectTarget(trx) {
  const { rows: tableRows } = await trx.raw(
    "select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'",
  );
  const tables = tableRows.map((r) => r.table_name).filter((n) => !SKIP.has(n)).sort();
  if (tables.join() !== [...TABLES].sort().join()) throw new Error(`Menolak: tabel target [${tables}] tidak cocok dengan tabel aplikasi.`);

  const local = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();
  const { rows: [{ reg }] } = await trx.raw("select to_regclass('knex_migrations') as reg");
  const done = reg ? (await trx('knex_migrations').pluck('name')).sort() : [];
  if (done.join() !== local.join()) {
    throw new Error(`Menolak: migration target [${done}] != repo [${local}]. Jalankan migrate-staging.js latest dulu.`);
  }

  const { rows: colRows } = await trx.raw(
    `select table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
       from information_schema.columns where table_schema = current_schema()`,
  );
  const columns = new Map(TABLES.map((t) => [t, new Map()]));
  for (const r of colRows) {
    columns.get(r.table_name)?.set(r.column_name, {
      type: r.data_type,
      maxLength: r.character_maximum_length,
      nullable: r.is_nullable === 'YES',
      hasDefault: r.column_default !== null,
    });
  }

  const { rows: fks } = await trx.raw(
    `select c.conrelid::regclass::text as child, a.attname as col,
            c.confrelid::regclass::text as parent, af.attname as ref, array_length(c.conkey, 1) as n
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and c.connamespace = current_schema()::regnamespace`,
  );
  for (const fk of fks) {
    if (fk.n !== 1) throw new Error(`FK multi-kolom ${fk.child} belum didukung importer.`);
    if (TABLES.indexOf(fk.parent) >= TABLES.indexOf(fk.child)) {
      throw new Error(`Urutan import salah: ${fk.child} bergantung pada ${fk.parent}.`);
    }
  }

  const sequences = new Map();
  for (const t of TABLES) {
    const { rows: [{ seq }] } = await trx.raw('select pg_get_serial_sequence(?, ?) as seq', [t, 'id']);
    if (!seq) throw new Error(`Menolak: ${t}.id tidak punya sequence.`);
    sequences.set(t, seq);
  }
  return { columns, fks, sequences };
}

/**
 * Bandingkan skema source vs target, baca + konversi SEMUA baris. Tidak menulis.
 * ponytail: seluruh tabel dimuat ke memori (cukup untuk katalog EduLib);
 * ganti ke stream per-chunk kalau satu tabel melewati ~1 juta baris.
 */
async function buildPlan(src, target, seqs) {
  const plan = [];
  for (const table of TABLES) {
    const tcols = target.columns.get(table);
    const scols = (await src.raw(`PRAGMA table_info(${JSON.stringify(table)})`)).map((c) => c.name);
    if (!scols.includes('id')) throw new Error(`Menolak: ${table} di source tidak punya kolom id.`);

    const columns = [];
    for (const name of scols) {
      if (tcols.has(name)) { columns.push(name); continue; }
      // Kolom legacy yang tidak ada di target hanya boleh dibuang kalau kosong total.
      const { c } = await src(table).whereNotNull(name).count('* as c').first();
      if (Number(c)) throw new Error(`Menolak: kolom legacy ${table}.${name} berisi ${c} baris dan tidak ada di target.`);
      log(`${table}.${name}: kolom legacy kosong, tidak diimpor`);
    }
    for (const [name, col] of tcols) {
      if (!scols.includes(name) && !col.nullable && !col.hasDefault) {
        throw new Error(`Menolak: ${table}.${name} wajib di target tapi tidak ada di source.`);
      }
    }

    const rows = [];
    const ids = new Set();
    for (const raw of await src(table).select(columns).orderBy('id')) {
      const label = `${table} id=${raw.id ?? 'NULL'}`;
      const row = {};
      for (const name of columns) {
        try {
          row[name] = convert(raw[name], tcols.get(name));
          if (typeof row[name] === 'string' && row[name].includes('\0')) throw new Error('mengandung karakter NUL');
        } catch (err) {
          throw new Error(`Menolak: ${label} kolom ${name}: ${err.message}.`);
        }
      }
      if (!(row.id > 0)) throw new Error(`Menolak: ${label}: id harus positif.`);
      if (ids.has(row.id)) throw new Error(`Menolak: ${label}: duplikat id.`);
      ids.add(row.id);
      rows.push(row);
    }

    const maxId = rows.length ? rows[rows.length - 1].id : 0;
    // sqlite_sequence ikut dihormati: id yang pernah dipakai lalu dihapus tidak dipakai ulang.
    const restart = Math.max(maxId, seqs.get(table) ?? 0) + 1;
    if (restart > INT_MAX) throw new Error(`Menolak: ${table} sequence ${restart} melebihi integer.`);
    plan.push({ table, columns, rows, maxId, restart, sequence: target.sequences.get(table) });
  }
  return plan;
}

async function countAll(trx) {
  const counts = {};
  for (const t of TABLES) counts[t] = Number((await trx(t).count('* as c').first()).c);
  return counts;
}

/** Verifikasi di dalam transaksi apply; gagal -> ROLLBACK. */
async function verify(trx, plan, fks) {
  for (const p of plan) {
    const ids = await trx(p.table).orderBy('id').pluck('id');
    if (ids.length !== p.rows.length || ids.some((id, i) => id !== p.rows[i].id)) {
      throw new Error(`Verifikasi gagal: ${p.table} jumlah/id target (${ids.length}) != source (${p.rows.length}).`);
    }
    const { rows: [s] } = await trx.raw('select last_value, is_called from ??', [p.sequence]);
    if (Number(s.last_value) !== p.restart || s.is_called || p.restart <= p.maxId) {
      throw new Error(`Verifikasi gagal: sequence ${p.sequence} = ${s.last_value}/${s.is_called}, harap ${p.restart}.`);
    }
  }
  for (const fk of fks) {
    const { rows: [{ c }] } = await trx.raw(
      'select count(*) as c from ?? ch left join ?? pa on pa.?? = ch.?? where ch.?? is not null and pa.?? is null',
      [fk.child, fk.parent, fk.ref, fk.col, fk.col, fk.ref],
    );
    if (Number(c)) throw new Error(`Verifikasi gagal: ${c} baris ${fk.child}.${fk.col} tanpa ${fk.parent}.`);
  }
}

async function importInto(trx, plan, fks) {
  for (const p of plan) {
    for (let i = 0; i < p.rows.length; i += CHUNK) {
      const chunk = p.rows.slice(i, i + CHUNK);
      try {
        await trx(p.table).insert(chunk);
      } catch (err) {
        // Pesan Knex memuat SQL + binding (hash password, email). Jangan diteruskan.
        throw new Error(`Insert ${p.table} id ${chunk[0].id}..${chunk[chunk.length - 1].id} gagal: `
          + `${err.code || 'error'} ${err.constraint || ''}`.trim());
      }
    }
    // ALTER SEQUENCE ikut transaksi (setval tidak). Nilai sudah divalidasi integer.
    await trx.raw(`ALTER SEQUENCE ?? RESTART WITH ${Number(p.restart)}`, [p.sequence]);
  }
  await verify(trx, plan, fks);
}

function pgFromEnv(env) {
  return knexFactory({
    client: 'pg',
    connection: {
      host: env.DB_HOST, port: env.DB_PORT, database: env.DB_DATABASE,
      user: env.DB_USER, password: env.DB_PASSWORD,
    },
    pool: { min: 0, max: 1 },
  });
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({ args: argv, options: { source: { type: 'string' }, apply: { type: 'boolean', default: false } } });
  if (!values.source) throw new Error('Perintah: node scripts/import-sqlite-to-pg.js --source <snapshot.db> [--apply]');
  // Guard tanpa I/O jaringan: DB/role *_staging, lalu konfirmasi eksplisit.
  const expected = assertStagingTarget(env, 'status');
  if (values.apply && env.CONFIRM_IMPORT_DB !== expected.database) {
    throw new Error(`Menolak: set CONFIRM_IMPORT_DB=${expected.database} untuk --apply.`);
  }

  const file = checkSourceFile(values.source);
  const hashBefore = sha256(file);
  const src = knexFactory({
    client: 'sqlite3',
    connection: { filename: `${pathToFileURL(file).href}?mode=ro`, flags: ['OPEN_URI'] },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
  let pg;
  let report;
  try {
    const { seqs } = await inspectSource(src);
    const srcMigrations = (await src('knex_migrations').pluck('name').catch(() => [])).sort();
    const local = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.js')).sort();
    if (srcMigrations.join() !== local.join()) {
      throw new Error(`Menolak: migration source [${srcMigrations}] != repo [${local}]. Migrasikan SALINAN source dulu.`);
    }

    pg = pgFromEnv(env);
    report = await pg.transaction(async (trx) => {
      if (!values.apply) await trx.raw('SET TRANSACTION READ ONLY');
      const { rows: [server] } = await trx.raw('select current_database() as database, current_user as user');
      if (server.database !== expected.database || server.user !== expected.user) {
        throw new Error(`Menolak: server melaporkan ${server.user}@${server.database}, bukan ${expected.user}@${expected.database}.`);
      }
      const target = await inspectTarget(trx);
      // Kunci dulu baru cek kosong: tidak ada penulis lain di antara cek dan insert.
      if (values.apply) await trx.raw(`LOCK TABLE ${TABLES.map(() => '??').join(', ')} IN ACCESS EXCLUSIVE MODE`, TABLES);
      const nonEmpty = Object.entries(await countAll(trx)).filter(([, c]) => c);
      if (nonEmpty.length) {
        throw new Error(`Menolak: target tidak kosong (${nonEmpty.map(([t, c]) => `${t}=${c}`).join(', ')}). Buat ulang DB staging.`);
      }
      const plan = await buildPlan(src, target, seqs);
      if (values.apply) await importInto(trx, plan, target.fks);
      // Cek ulang SEBELUM commit: source berubah -> throw -> ROLLBACK total.
      if (sha256(file) !== hashBefore) {
        throw new Error('Menolak: file source berubah selama import; snapshot tidak konsisten, transaksi di-rollback.');
      }
      return plan.map(({ table, rows, maxId, restart }) => ({ table, rows: rows.length, maxId, restart }));
    });
  } finally {
    await src.destroy();
    if (pg) await pg.destroy();
  }

  for (const r of report) log(`${r.table}: ${r.rows} baris, max id ${r.maxId}, sequence -> ${r.restart}`);
  log(values.apply ? `SELESAI: data di-commit ke ${expected.database}.` : 'DRY-RUN: valid, tidak ada yang ditulis. Ulangi dengan --apply.');
  return { applied: values.apply, tables: report };
}

if (require.main === module) {
  main().catch((err) => { console.error('[import] GAGAL:', err.message); process.exitCode = 1; });
}

module.exports = { TABLES, convert, checkSourceFile, main };
