/**
 * ucup-edu-lib :: Buat user admin langsung di DB
 *
 * Jalankan dari root project. Kredensial lewat environment variable, BUKAN
 * argumen CLI — argumen terlihat di `ps` dan tersimpan di shell history.
 *
 *   ADMIN_EMAIL='admin@contoh.com' \
 *   ADMIN_NAME='Nama Admin' \
 *   ADMIN_PASSWORD='...' \
 *   node scripts/create-admin.js
 *
 * Lihat daftar user + siapa yang admin:
 *   node scripts/promote-admin.js --list
 *
 * Kenapa ini ada: form /register hanya membuat role 'member', dan tidak ada
 * endpoint untuk menaikkan role. Script ini jalur admin pertama.
 *
 * Password di-hash bcrypt cost 10 — sama dengan SALT_ROUNDS di
 * backend/routes/auth.js, supaya bcrypt.compare saat login cocok.
 *
 * Password TIDAK pernah dicetak ke stdout maupun log.
 * Kalau user sudah ada, password TIDAK ditimpa — hanya role yang dinaikkan.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const bcrypt = require('bcrypt');
const db = require('../backend/models/db');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const fullName = (process.env.ADMIN_NAME || '').trim();
const password = process.env.ADMIN_PASSWORD || '';

const SALT_ROUNDS = 10; // harus sama dengan backend/routes/auth.js
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

(async () => {
  try {
    if (!email || !fullName || !password) {
      throw new Error(
        'ADMIN_EMAIL, ADMIN_NAME, dan ADMIN_PASSWORD wajib diisi.\n' +
        "  Contoh: ADMIN_EMAIL='a@b.com' ADMIN_NAME='Admin' ADMIN_PASSWORD='...' node scripts/create-admin.js",
      );
    }
    if (!EMAIL_RE.test(email)) throw new Error(`Format email tidak valid: ${email}`);
    // Batas sama dengan endpoint register supaya akun buatan script ini tidak
    // lebih lemah dari yang lewat form.
    if (password.length < 6) throw new Error('Password minimal 6 karakter');
    if (Buffer.byteLength(password, 'utf8') > 72) throw new Error('Password maksimal 72 byte');

    const existing = await db('users').whereRaw('lower(email) = ?', [email]).first();

    if (existing) {
      if (existing.role === 'admin') {
        console.log(`User sudah ada dan sudah admin (id=${existing.id}). Tidak ada perubahan.`);
      } else {
        await db('users').where('id', existing.id).update({ role: 'admin' });
        console.log(`User sudah ada — role dinaikkan ke admin (id=${existing.id}).`);
        console.log('Password TIDAK diubah (menimpa password user yang ada itu destruktif).');
      }
    } else {
      const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
      const [id] = await db('users').insert({
        email,
        password_hash,
        full_name: fullName,
        role: 'admin',
      });
      console.log(`User admin dibuat (id=${id}).`);
    }

    // Baca ulang dari DB: laporkan hasil, bukan niat.
    const row = await db('users')
      .whereRaw('lower(email) = ?', [email])
      .first('id', 'email', 'full_name', 'role');
    console.log(`  id=${row.id}  ${row.email}  "${row.full_name}"  role=${row.role}`);
    if (row.role !== 'admin') throw new Error(`role masih "${row.role}"`);

    console.log('\nLangkah berikutnya: login di /login, lalu buka /admin.');
    console.log('Kalau sudah pernah login sebelumnya, LOGOUT dulu — role ikut di dalam');
    console.log('token JWT, jadi token lama masih dianggap member.');
  } catch (err) {
    console.error('GAGAL:', err.message);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
})();
