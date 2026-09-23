/**
 * ucup-edu-lib :: Buang kolom mati `contents.cover_image_url`
 *
 * Kolom cover yang dipakai seluruh sistem adalah `cover_url` (upload R2, admin,
 * search, frontend). `cover_image_url` adalah sisa skema lama: pada DB lokal
 * 0 dari 9 baris terisi dan tidak ada satu pun kode yang membacanya.
 *
 * TIDAK mengasumsikan kolomnya kosong di production. DB di VPS bisa berbeda dari
 * lokal, jadi nilai yang masih ada dipindahkan ke `cover_url` dulu (hanya kalau
 * `cover_url` NULL, supaya tidak menimpa cover yang lebih baru), baru kolomnya
 * di-drop. Kalau ada baris yang tidak bisa diselamatkan, migrasi BERHENTI
 * daripada menghapus data diam-diam.
 *
 * Catatan: `database/init.js` (jalur legacy, sudah digantikan migrations/) masih
 * menyebut cover_image_url, tapi aksesnya dibungkus `if (cols.includes(...))`
 * jadi tetap aman setelah kolomnya hilang. Dibiarkan apa adanya — di luar
 * cakupan perubahan ini.
 */
'use strict';

const TABLE = 'contents';
const DEAD = 'cover_image_url';
const KEEP = 'cover_url';

exports.up = async function up(knex) {
  const info = await knex.raw(`PRAGMA table_info(${TABLE})`);
  const columns = info.map((c) => c.name);

  if (!columns.includes(DEAD)) {
    console.log(`  [drop_cover] ${DEAD} sudah tidak ada, dilewati`);
    return;
  }
  // Tanpa kolom tujuan, memindahkan data tidak mungkin — lebih baik gagal.
  if (!columns.includes(KEEP)) {
    throw new Error(`[drop_cover] ${KEEP} tidak ada; jalankan baseline schema dulu`);
  }

  // 1. Selamatkan nilai yang masih terpakai.
  const salvaged = await knex(TABLE)
    .whereNotNull(DEAD)
    .whereNull(KEEP)
    .update({ [KEEP]: knex.ref(DEAD) });
  if (salvaged) console.log(`  [drop_cover] ${salvaged} baris dipindah ${DEAD} -> ${KEEP}`);

  // 2. Sisa baris yang masih punya nilai DEAD tapi KEEP-nya sudah terisi:
  //    nilainya akan hilang saat drop. Kalau nilainya BEDA, itu kehilangan data
  //    yang nyata, jadi migrasi dihentikan supaya bisa diperiksa manual.
  const conflicts = await knex(TABLE)
    .whereNotNull(DEAD)
    .whereNotNull(KEEP)
    .whereRaw(`${DEAD} <> ${KEEP}`)
    .select('id', DEAD, KEEP);
  if (conflicts.length) {
    const sample = conflicts.slice(0, 5).map((r) => `id=${r.id}`).join(', ');
    throw new Error(
      `[drop_cover] ${conflicts.length} baris punya ${DEAD} berbeda dari ${KEEP} (${sample}). ` +
      `Periksa manual sebelum drop — nilai itu akan hilang.`,
    );
  }

  // 3. Drop. Butuh SQLite >= 3.35; sqlite3 npm membundel versi jauh lebih baru.
  //    Aman di sini karena kolomnya tidak diindeks dan tidak dipakai constraint.
  await knex.schema.alterTable(TABLE, (t) => t.dropColumn(DEAD));
  console.log(`  [drop_cover] kolom ${DEAD} dibuang`);

  const after = (await knex.raw(`PRAGMA table_info(${TABLE})`)).map((c) => c.name);
  if (after.includes(DEAD)) throw new Error(`[drop_cover] ${DEAD} masih ada setelah drop`);
  if (!after.includes(KEEP)) throw new Error(`[drop_cover] ${KEEP} hilang — rollback`);
};

exports.down = async function down(knex) {
  const columns = (await knex.raw(`PRAGMA table_info(${TABLE})`)).map((c) => c.name);
  if (columns.includes(DEAD)) return;
  // Kolomnya dibuat ulang KOSONG. Nilai lama tidak dipulihkan: yang masih
  // terpakai sudah dipindah ke cover_url oleh up(), jadi tidak ada yang hilang.
  await knex.schema.alterTable(TABLE, (t) => t.text(DEAD).nullable());
  console.log(`  [drop_cover] ${DEAD} dibuat ulang (kosong)`);
};
