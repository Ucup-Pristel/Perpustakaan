-- ucup-edu-lib :: promote user jadi admin
-- Jalankan manual: sqlite3 database/ucup-edu-lib.db < database/seed_admin.sql
-- User harus sudah register lewat POST /api/auth/register dulu (password di-hash bcrypt di sana).
-- ponytail: promote manual via SQL; ganti dengan endpoint admin-manage-users kalau perlu >1 admin sering.

UPDATE users
SET role = 'admin'
WHERE email IN ('ucup@gmail.com', 'admin@edulib.id');

SELECT id, email, full_name, role FROM users WHERE role = 'admin';
