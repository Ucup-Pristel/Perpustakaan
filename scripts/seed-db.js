/**
 * ucup-edu-lib :: Sample data seed (khusus development lokal)
 *
 *   npm run migrate
 *   npm run seed -- --sample
 *
 * - Schema TIDAK dibuat di sini. Sumber kebenaran: database/migrations/.
 *   Kalau masih ada migration pending, script berhenti.
 * - Koneksi memakai backend/models/db.js (DB_CLIENT/DB_FILENAME/DB_* dari .env),
 *   bukan config SQLite hardcoded.
 * - Opt-in eksplisit: tanpa flag `--sample` tidak ada yang ditulis.
 * - Menolak NODE_ENV=production dan menolak DB yang katalognya sudah berisi
 *   (fields/sub_fields/contents/content_paths) — DB produksi selalu berisi.
 * - Semua insert dalam satu transaksi + `.returning('id')` (SQLite & PostgreSQL
 *   sama-sama mengembalikan [{ id }]).
 */
'use strict';

const CATALOG_TABLES = ['fields', 'sub_fields', 'contents', 'content_paths'];

const FIELDS = [
  { slug: 'management',   name: 'Manajemen',          description: 'Jalur karier dalam dunia bisnis dan manajemen organisasi',        icon: '💼', color: '#2563EB', sort_order: 1 },
  { slug: 'technology',   name: 'Teknologi',           description: 'Ilmu komputer, rekayasa perangkat lunak, dan kecerdasan buatan',  icon: '💻', color: '#16A34A', sort_order: 2 },
  { slug: 'health',       name: 'Kesehatan',           description: 'Kedokteran, keperawatan, farmasi, dan ilmu kesehatan lainnya',    icon: '🏥', color: '#DC2626', sort_order: 3 },
  { slug: 'education',    name: 'Pendidikan',          description: 'Pedagogi, kurikulum, dan pengembangan sumber daya manusia',       icon: '📚', color: '#D97706', sort_order: 4 },
  { slug: 'creative-art', name: 'Seni & Kreativitas',  description: 'Desain grafis, seni rupa, musik, dan industri kreatif',          icon: '🎨', color: '#7C3AED', sort_order: 5 },
];

const SUBFIELDS = [
  { field_slug: 'management',   slug: 'marketing',            name: 'Pemasaran',                  description: 'Strategi, riset pasar, branding, dan digital marketing',     sort_order: 1 },
  { field_slug: 'management',   slug: 'human-resource',       name: 'Sumber Daya Manusia',        description: 'Rekrutmen, pengembangan, dan manajemen talenta',              sort_order: 2 },
  { field_slug: 'technology',   slug: 'software-engineering', name: 'Rekayasa Perangkat Lunak',   description: 'Pengembangan aplikasi web, mobile, dan sistem',               sort_order: 1 },
  { field_slug: 'technology',   slug: 'data-science',         name: 'Ilmu Data',                  description: 'Analisis data, machine learning, dan visualisasi',            sort_order: 2 },
  { field_slug: 'health',       slug: 'general-medicine',     name: 'Kedokteran Umum',            description: 'Ilmu kedokteran dasar dan klinis',                           sort_order: 1 },
  { field_slug: 'education',    slug: 'early-childhood',      name: 'Pendidikan Anak Usia Dini',  description: 'PAUD, metode bermain sambil belajar, dan perkembangan anak', sort_order: 1 },
  { field_slug: 'creative-art', slug: 'graphic-design',       name: 'Desain Grafis',              description: 'Tipografi, komposisi visual, dan desain digital',             sort_order: 1 },
];

const CONTENTS = [
  { sub: 'marketing',            title: 'Dasar Pemasaran Digital',             author: 'Philip Kotler',    level: 1, type: 'pdf',   lang: 'id', tags: '["marketing","digital","pemula"]',       desc: 'Pengantar konsep pemasaran di era digital untuk pemula', file_url: 'https://pub-7685e8ab88834373877bac51cfafd174.r2.dev/Computer%20Engineering/Buku%20Kurikulum%202024%20Prodi%20S1%20TK%20final_V2.4.pdf' },
  { sub: 'marketing',            title: 'Strategi SEO Terkini',                author: 'Neil Patel',       level: 2, type: 'ebook', lang: 'id', tags: '["seo","digital","marketing"]',           desc: 'Teknik optimasi mesin pencari untuk bisnis online' },
  { sub: 'software-engineering', title: 'Pengantar Pemrograman dengan Python', author: 'Tim Peters',       level: 1, type: 'pdf',   lang: 'id', tags: '["python","programming","pemula"]',         desc: 'Belajar Python dari nol: variabel, fungsi, dan OOP' },
  { sub: 'software-engineering', title: 'Clean Code',                          author: 'Robert C. Martin', level: 3, type: 'ebook', lang: 'en', tags: '["clean-code","software","best-practice"]',  desc: 'Panduan menulis kode yang bersih dan mudah dipelihara' },
  { sub: 'data-science',         title: 'Statistika untuk Data Science',       author: 'Hadley Wickham',   level: 2, type: 'pdf',   lang: 'id', tags: '["statistika","data","analisis"]',           desc: 'Konsep statistika dasar yang wajib dikuasai data scientist' },
  { sub: 'general-medicine',     title: 'Anatomi Tubuh Manusia',               author: 'Frank Netter',     level: 2, type: 'ebook', lang: 'id', tags: '["anatomi","kedokteran","ilmu-dasar"]',      desc: 'Atlas anatomi tubuh manusia lengkap dengan ilustrasi' },
  { sub: 'early-childhood',      title: 'Metode Montessori',                   author: 'Maria Montessori', level: 1, type: 'pdf',   lang: 'id', tags: '["montessori","paud","anak"]',               desc: 'Pendekatan pendidikan berbasis kebebasan dan eksplorasi' },
  { sub: 'graphic-design',       title: 'Prinsip Desain Grafis',               author: 'Robin Williams',   level: 1, type: 'ebook', lang: 'id', tags: '["desain","tipografi","visual"]',             desc: 'Empat prinsip dasar desain: kontras, repetisi, alignment, kedekatan' },
];

/** Tolak DB yang katalognya sudah berisi. PostgreSQL mengembalikan COUNT sebagai string. */
async function assertEmptyCatalog(db) {
  for (const table of CATALOG_TABLES) {
    const { c } = await db(table).count('* as c').first();
    if (Number(c) > 0) {
      throw new Error(`Tabel ${table} sudah berisi ${c} baris; seed hanya untuk DB kosong. Tidak ada yang ditulis.`);
    }
  }
}

/** Insert sample data. `db` boleh knex atau transaksi. */
async function seedSample(db) {
  const fieldIds = {};
  for (const f of FIELDS) {
    const [{ id }] = await db('fields').insert({ ...f, is_active: true }).returning('id');
    fieldIds[f.slug] = id;
  }

  const subIds = {};
  for (const { field_slug, ...sf } of SUBFIELDS) {
    const [{ id }] = await db('sub_fields').insert({ ...sf, field_id: fieldIds[field_slug] }).returning('id');
    subIds[sf.slug] = id;
  }

  for (const c of CONTENTS) {
    await db('contents').insert({
      sub_field_id: subIds[c.sub], title: c.title, author: c.author, description: c.desc,
      level: c.level, content_type: c.type, file_url: c.file_url || null, language: c.lang,
      tags: c.tags, is_featured: false, read_count: 0,
    });
  }
  return { fields: FIELDS.length, sub_fields: SUBFIELDS.length, contents: CONTENTS.length };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  if (!argv.includes('--sample')) {
    throw new Error('Sample seeding wajib opt-in: npm run seed -- --sample');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('Menolak seed: NODE_ENV=production.');
  }

  const db = require('../backend/models/db');
  try {
    const [, pending] = await db.migrate.list();
    if (pending.length) {
      throw new Error(`${pending.length} migration belum dijalankan; jalankan \`npm run migrate\` dulu.`);
    }
    await assertEmptyCatalog(db);
    const counts = await db.transaction((trx) => seedSample(trx));
    console.log(`[seed] Selesai: ${counts.fields} fields, ${counts.sub_fields} sub_fields, ${counts.contents} contents`);
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('[seed] GAGAL:', err.message); process.exitCode = 1; });
}

module.exports = { assertEmptyCatalog, seedSample, main };
