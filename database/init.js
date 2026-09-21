/**
 * ucup-edu-lib :: Database Init
 * Jalankan: node database/init.js
 */
'use strict';
const path    = require('path');
const fs      = require('fs');
const sqlite3 = require('sqlite3').verbose();

const DB_PATH     = path.resolve(__dirname, 'ucup-edu-lib.db');
const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

const db = new sqlite3.Database(DB_PATH, err => {
  if (err) { console.error('Gagal buka DB:', err.message); process.exit(1); }
  console.log('[init] DB:', DB_PATH);
});

const exec = sql => new Promise((res, rej) => db.exec(sql, err => err ? rej(err) : res()));
const run  = (sql, p=[]) => new Promise((res, rej) => db.run(sql, p, function(err){ err ? rej(err) : res(this); }));
const get  = (sql, p=[]) => new Promise((res, rej) => db.get(sql, p, (err, row) => err ? rej(err) : res(row)));
const all  = (sql, p=[]) => new Promise((res, rej) => db.all(sql, p, (err, rows) => err ? rej(err) : res(rows)));

async function main() {
  // 1. schema.sql
  console.log('\n[init] Eksekusi schema.sql...');
  await exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

  // 2. Tabel tambahan untuk instalasi database lama.
  await exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reading_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content_id INTEGER NOT NULL,
      last_page INTEGER NOT NULL DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, content_id)
    );
  `);

  const noteCols = (await all('PRAGMA table_info(notes)')).map(r => r.name);
  if (!noteCols.includes('updated_at')) {
    await run('ALTER TABLE notes ADD COLUMN updated_at DATETIME');
    await run('UPDATE notes SET updated_at = created_at WHERE updated_at IS NULL');
    console.log('  + notes.updated_at kolom ditambah');
  }
  await run('CREATE UNIQUE INDEX IF NOT EXISTS notes_user_content_page_unique ON notes(user_id, content_id, page_number)');

  // Pastikan file_url tersedia untuk PDF/ebook pada database lama.
  const contentCols = (await all('PRAGMA table_info(contents)')).map(r => r.name);
  if (!contentCols.includes('file_url')) {
    await run('ALTER TABLE contents ADD COLUMN file_url TEXT');
    console.log('  + file_url kolom ditambah');
  }
  if (!contentCols.includes('cover_url')) {
    await run('ALTER TABLE contents ADD COLUMN cover_url TEXT');
    if (contentCols.includes('cover_image_url')) {
      await run('UPDATE contents SET cover_url = cover_image_url WHERE cover_url IS NULL');
    }
    console.log('  + cover_url kolom ditambah (dari cover_image_url jika ada)');
  }

  // Tambah kolom baru ke user_progress jika belum ada
  const cols = (await all('PRAGMA table_info(user_progress)')).map(r => r.name);
  if (!cols.includes('last_page_read')) {
    await run('ALTER TABLE user_progress ADD COLUMN last_page_read INTEGER NOT NULL DEFAULT 0');
    console.log('  + last_page_read kolom ditambah');
  }
  if (!cols.includes('updated_at')) {
    await run('ALTER TABLE user_progress ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP');
    console.log('  + updated_at kolom ditambah');
  }
  console.log('  [ok] semua tabel siap');

  // 3. Seed fields
  console.log('\n[init] Seed data...');
  const { c } = await get('SELECT COUNT(*) as c FROM fields');
  if (c > 0) {
    console.log(`  [skip] fields sudah ada (${c} baris)`);
  } else {
    const FIELDS = [
      ['technology',   'Teknologi',  'Ilmu komputer, rekayasa perangkat lunak, dan kecerdasan buatan', '\u{1F4BB}', '#16A34A', 1],
      ['business',     'Bisnis',     'Manajemen, kewirausahaan, keuangan, dan strategi bisnis',        '\u{1F4BC}', '#2563EB', 2],
      ['creative-art', 'Seni',       'Desain grafis, seni rupa, musik, dan industri kreatif',          '\u{1F3A8}', '#7C3AED', 3],
      ['health',       'Kesehatan',  'Kedokteran, keperawatan, farmasi, dan ilmu kesehatan',           '\u{1F3E5}', '#DC2626', 4],
      ['education',    'Pendidikan', 'Pedagogi, kurikulum, dan pengembangan SDM',                      '\u{1F4DA}', '#D97706', 5],
    ];
    for (const [slug, name, desc, icon, color, ord] of FIELDS) {
      await run('INSERT INTO fields (slug,name,description,icon,color,sort_order,is_active) VALUES (?,?,?,?,?,?,1)',
        [slug, name, desc, icon, color, ord]);
      console.log(`  [insert] field: ${name}`);
    }

    const techId = (await get("SELECT id FROM fields WHERE slug='technology'")).id;
    const bizId  = (await get("SELECT id FROM fields WHERE slug='business'")).id;
    const artId  = (await get("SELECT id FROM fields WHERE slug='creative-art'")).id;

    const SUBS = [
      [techId, 'software-engineering', 'Rekayasa Perangkat Lunak', 'Web, mobile, dan sistem', 1],
      [techId, 'data-science',         'Ilmu Data',               'Analisis data dan ML',    2],
      [bizId,  'marketing',            'Pemasaran',               'Strategi dan digital marketing', 1],
      [artId,  'graphic-design',       'Desain Grafis',           'Tipografi dan desain digital',   1],
    ];
    for (const [fid, slug, name, desc, ord] of SUBS) {
      await run('INSERT INTO sub_fields (field_id,slug,name,description,sort_order) VALUES (?,?,?,?,?)',
        [fid, slug, name, desc, ord]);
      console.log(`  [insert] subfield: ${name}`);
    }

    const seId = (await get("SELECT id FROM sub_fields WHERE slug='software-engineering'")).id;
    const dsId = (await get("SELECT id FROM sub_fields WHERE slug='data-science'")).id;
    const mkId = (await get("SELECT id FROM sub_fields WHERE slug='marketing'")).id;

    const CONTENTS = [
      [seId, 'Pengantar Python',         'Tim Peters',   1, 'pdf',   'id', '["python","pemula"]',          'Belajar Python dari nol'],
      [seId, 'Clean Code',              'R.C. Martin',  3, 'ebook', 'en', '["clean-code"]',               'Menulis kode yang bersih'],
      [dsId, 'Statistika Dasar',        'H. Wickham',   2, 'pdf',   'id', '["statistika","data"]',        'Statistika untuk data scientist'],
      [mkId, 'Dasar Pemasaran Digital', 'P. Kotler',    1, 'pdf',   'id', '["marketing","digital"]',      'Pengantar digital marketing'],
    ];
    for (const [sid, title, author, level, type, lang, tags, desc] of CONTENTS) {
      await run('INSERT INTO contents (sub_field_id,title,author,description,level,content_type,tags,language,is_featured,read_count) VALUES (?,?,?,?,?,?,?,?,0,0)',
        [sid, title, author, desc, level, type, tags, lang]);
      console.log(`  [insert] content: ${title}`);
    }
  }

  console.log('\n[init] Database siap \u2713');
  db.close();
}

main().catch(err => { console.error('[init] ERROR:', err.message); db.close(); process.exit(1); });
