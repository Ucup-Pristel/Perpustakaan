-- ucup-edu-lib :: promote user jadi admin (REFERENSI SQL)
--
-- JANGAN pakai file ini kalau `sqlite3` CLI tidak terpasang. Cara yang dipakai:
--   node scripts/promote-admin.js <email>
--   node scripts/promote-admin.js --list
--
-- Versi lama file ini meng-hardcode email yang tidak ada di DB, jadi UPDATE-nya
-- mengenai 0 baris tanpa peringatan apa pun. Ganti <EMAIL> di bawah dengan
-- email yang BENAR-BENAR sudah terdaftar.
--
-- User harus register dulu lewat POST /api/auth/register (password di-hash bcrypt
-- di sana). Script ini tidak pernah membuat user atau menyentuh password.

UPDATE users SET role = 'admin' WHERE lower(email) = lower('<EMAIL>');

SELECT id, email, full_name, role FROM users WHERE role = 'admin';
