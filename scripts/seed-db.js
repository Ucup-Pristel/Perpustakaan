/**
 * ucup-edu-lib :: Database Seed Script
 * Jalankan dari root project: node scripts/seed-db.js
 */
'use strict';
require('dotenv').config();

const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: process.env.DB_FILENAME || './database/ucup-edu-lib.db' },
  useNullAsDefault: true,
});

async function createTables() {
  if (!await knex.schema.hasTable('fields')) {
    await knex.schema.createTable('fields', t => {
      t.increments('id').primary();
      t.string('slug').unique().notNullable();
      t.string('name').notNullable();
      t.text('description');
      t.string('icon');
      t.string('color');
      t.integer('sort_order').defaultTo(0);
      t.boolean('is_active').defaultTo(true);
    });
    console.log('  [create] fields');
  } else { console.log('  [skip]   fields (sudah ada)'); }

  if (!await knex.schema.hasTable('sub_fields')) {
    await knex.schema.createTable('sub_fields', t => {
      t.increments('id').primary();
      t.integer('field_id').notNullable().references('id').inTable('fields');
      t.string('slug').unique().notNullable();
      t.string('name').notNullable();
      t.text('description');
      t.integer('parent_id');
      t.integer('sort_order').defaultTo(0);
    });
    console.log('  [create] sub_fields');
  } else { console.log('  [skip]   sub_fields (sudah ada)'); }

  if (!await knex.schema.hasTable('contents')) {
    await knex.schema.createTable('contents', t => {
      t.increments('id').primary();
      t.integer('sub_field_id').references('id').inTable('sub_fields');
      t.string('title').notNullable();
      t.string('author');
      t.text('description');
      t.integer('level');
      t.string('content_type');
      t.string('source_url');
      t.string('file_url');
      t.string('cover_url');
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
    console.log('  [create] contents');
  } else { console.log('  [skip]   contents (sudah ada)'); }

  if (!await knex.schema.hasTable('content_paths')) {
    await knex.schema.createTable('content_paths', t => {
      t.increments('id').primary();
      t.integer('sub_field_id').references('id').inTable('sub_fields');
      t.integer('from_content_id');
      t.integer('to_content_id');
      t.string('path_type');
    });
    console.log('  [create] content_paths');
  } else { console.log('  [skip]   content_paths (sudah ada)'); }

  if (!await knex.schema.hasTable('users')) {
    await knex.schema.createTable('users', t => {
      t.increments('id').primary();
      t.string('email').notNullable().unique();
      t.string('password_hash').notNullable();
      t.string('full_name').notNullable();
      t.string('role').notNullable().defaultTo('member');
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    console.log('  [create] users');
  } else { console.log('  [skip]   users (sudah ada)'); }

  if (!await knex.schema.hasTable('user_progress')) {
    await knex.schema.createTable('user_progress', t => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.integer('content_id').notNullable();
      t.integer('last_page_read').notNullable().defaultTo(0);
      t.string('status').notNullable().defaultTo('reading');
      t.timestamp('updated_at').defaultTo(knex.fn.now());
      t.unique(['user_id', 'content_id']);
    });
    console.log('  [create] user_progress');
  } else { console.log('  [skip]   user_progress (sudah ada)'); }

  if (!await knex.schema.hasTable('notes')) {
    await knex.schema.createTable('notes', t => {
      t.increments('id').primary();
      t.integer('user_id').notNullable();
      t.integer('content_id').notNullable();
      t.integer('page_number').notNullable();
      t.text('note_text').notNullable();
      t.timestamp('created_at').defaultTo(knex.fn.now());
    });
    console.log('  [create] notes');
  } else { console.log('  [skip]   notes (sudah ada)'); }
}

// ─── 2. Seed Data ─────────────────────────────────────────────────────────────

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

async function seedData() {
  const { c } = await knex('fields').count('id as c').first();
  if (c > 0) { console.log('  [skip]   data sudah ada'); return; }

  const fieldIds = {};
  for (const f of FIELDS) {
    const [id] = await knex('fields').insert({ slug: f.slug, name: f.name, description: f.description, icon: f.icon, color: f.color, sort_order: f.sort_order, is_active: 1 });
    fieldIds[f.slug] = id;
  }
  console.log(`  [insert] ${FIELDS.length} fields`);

  const subIds = {};
  for (const sf of SUBFIELDS) {
    const [id] = await knex('sub_fields').insert({ field_id: fieldIds[sf.field_slug], slug: sf.slug, name: sf.name, description: sf.description, sort_order: sf.sort_order });
    subIds[sf.slug] = id;
  }
  console.log(`  [insert] ${SUBFIELDS.length} sub_fields`);

  for (const c of CONTENTS) {
    await knex('contents').insert({ sub_field_id: subIds[c.sub], title: c.title, author: c.author, description: c.desc, level: c.level, content_type: c.type, file_url: c.file_url, language: c.lang, tags: c.tags, is_featured: 0, read_count: 0 });
  }
  console.log(`  [insert] ${CONTENTS.length} contents`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n[seed] Membuat tabel...');
  await createTables();
  console.log('\n[seed] Menyuntikkan data...');
  await seedData();
  console.log('\n[seed] Selesai ✓');
  await knex.destroy();
}

main().catch(err => { console.error('[seed] ERROR:', err.message); process.exit(1); });
