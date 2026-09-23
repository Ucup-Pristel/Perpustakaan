/**
 * ucup-edu-lib :: Jadikan user sebagai admin
 *
 * Jalankan dari root project:
 *   node scripts/promote-admin.js <email>
 *   node scripts/promote-admin.js --list
 *
 * Kenapa script node, bukan file .sql:
 *   - `sqlite3` CLI TIDAK selalu terpasang (di mesin dev ini tidak ada), jadi
 *     `sqlite3 database/...db < seed_admin.sql` gagal.
 *   - Email tidak boleh di-hardcode: seed_admin.sql sebelumnya menargetkan
 *     email yang tidak ada di DB, jadi UPDATE-nya mengenai 0 baris dan diam saja.
 *   - Script ini memverifikasi user-nya ada dan melaporkan hasil nyata.
 *
 * Script ini TIDAK membuat user dan TIDAK menyentuh password. Daftar dulu lewat
 * POST /api/auth/register (atau halaman /register), baru promote di sini.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const db = require('../backend/models/db');

async function list() {
  const users = await db('users').select('id', 'email', 'role').orderBy('id');
  if (!users.length) {
    console.log('Belum ada user. Daftar dulu lewat halaman /register.');
    return;
  }
  console.log('User terdaftar:');
  for (const u of users) console.log(`  id=${u.id}  ${u.role.padEnd(7)}  ${u.email}`);
  const admins = users.filter((u) => u.role === 'admin').length;
  console.log(`\nTotal admin: ${admins}${admins ? '' : '  <-- belum ada yang bisa upload konten'}`);
}

async function promote(email) {
  const user = await db('users').whereRaw('lower(email) = ?', [email.toLowerCase()]).first();
  if (!user) {
    console.error(`Email "${email}" tidak ditemukan.`);
    console.error('Daftar dulu lewat /register, lalu ulangi. Lihat daftar: node scripts/promote-admin.js --list');
    process.exitCode = 1;
    return;
  }
  if (user.role === 'admin') {
    console.log(`${user.email} sudah admin. Tidak ada perubahan.`);
    return;
  }

  await db('users').where('id', user.id).update({ role: 'admin' });

  // Baca ulang dari DB — jangan laporkan sukses dari niat, tapi dari hasil.
  const after = await db('users').where('id', user.id).first('id', 'email', 'role');
  if (after.role !== 'admin') {
    console.error(`GAGAL: role ${after.email} masih "${after.role}"`);
    process.exitCode = 1;
    return;
  }

  console.log(`${after.email} sekarang admin (id=${after.id}).`);
  console.log('\nPENTING: token JWT menyimpan role saat login, jadi sesi lama masih');
  console.log('dianggap member. Logout lalu login ulang supaya bisa upload.');
}

(async () => {
  try {
    const arg = process.argv[2];
    if (!arg || arg === '--list') return await list();
    if (arg.startsWith('-')) {
      console.error('Pemakaian: node scripts/promote-admin.js <email> | --list');
      process.exitCode = 1;
      return;
    }
    await promote(arg);
  } finally {
    await db.destroy();
  }
})().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
