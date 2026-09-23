/**
 * ucup-edu-lib :: Format URL konten (file PDF + cover)
 *
 * Satu sumber kebenaran untuk mengubah nilai kolom `file_url` / `cover_url`
 * menjadi URL publik. Sebelumnya logika ini diduplikasi di contents.js,
 * subfields.js, dan server.js — dan memang sudah pernah drift: cover_url tidak
 * pernah di-prefix sama sekali, dan subfields.js pernah dobel-prefix file_url.
 *
 * Aturan yang tidak boleh hilang: cek `^https?://` DULU. Nilai di DB campur —
 * ada yang absolut (hasil uploadToR2) dan ada yang relatif (hasil seed SQL).
 * Memprefix yang sudah absolut menghasilkan `https://x.r2.devhttps://x.r2.dev/...`
 * dan PDF/gambar gagal dibuka.
 */
'use strict';

// Dibaca saat dipanggil, bukan saat module di-load: server.js memanggil
// dotenv.config() setelah beberapa require, jadi membaca di top-level bisa
// mendapat undefined.
const r2Base = () => process.env.R2_PUBLIC_URL || '';

/** @returns {string|null} URL publik, atau null kalau kolomnya kosong. */
const toPublicUrl = (value) => {
  if (!value) return null;
  return /^https?:\/\//.test(value) ? value : `${r2Base()}${value}`;
};

/**
 * Bentuk satu baris `contents` untuk response API.
 * tags disimpan sebagai string JSON; satu baris rusak tidak boleh membuat
 * seluruh endpoint balas 500, jadi parse-nya defensif.
 */
const formatContent = (row) => ({
  ...row,
  file_url: toPublicUrl(row.file_url),
  cover_url: toPublicUrl(row.cover_url),
  tags: parseTags(row.tags),
});

function parseTags(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = { toPublicUrl, formatContent };
