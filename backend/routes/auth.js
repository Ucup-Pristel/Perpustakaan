/**
 * ucup-edu-lib :: Auth Routes (Member/Siswa)
 * POST /api/auth/register
 * POST /api/auth/login
 */

const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const { authLimiter, registerLimiter } = require('../middleware/rateLimiters');

const SECRET = () => process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

// Hash bcrypt asli (cost 10, sama dengan SALT_ROUNDS) dari password acak yang
// tidak dipakai siapa pun. Dibandingkan saat email tidak ditemukan supaya biaya
// waktu login sama antara "email tidak ada" dan "password salah".
// Cost HARUS sama dengan SALT_ROUNDS — kalau beda, selisih waktunya kembali.
const DUMMY_HASH = '$2b$10$AAjhIKVkdWH7HdQvLXMpxuH5UUEofARafJb0nXkMHRPbvcZZwWoPm';

// Helper: trim string atau return '' jika bukan string
const str = v => (typeof v === 'string' ? v.trim() : '');

// Regex email sederhana — cukup untuk trust boundary ini
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/register
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const email = str(req.body.email).toLowerCase();
    const password = str(req.body.password);
    const full_name = str(req.body.full_name);

    if (!email || !password || !full_name) {
      return res.status(400).json({ status: 'error', message: 'email, password, dan full_name wajib diisi' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ status: 'error', message: 'Format email tidak valid' });
    }
    if (password.length < 6) {
      return res.status(400).json({ status: 'error', message: 'Password minimal 6 karakter' });
    }

    const existing = await db('users').where({ email }).first();
    if (existing) {
      return res.status(409).json({ status: 'error', message: 'Email sudah terdaftar' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    const [id] = await db('users').insert({ email, password_hash, full_name });
    res.status(201).json({ status: 'success', message: 'Registrasi berhasil', data: { id, email, full_name } });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ status: 'error', message: 'Gagal registrasi' });
  }
});

// POST /api/auth/login — cek murni ke tabel users, tidak ada admin hardcoded
router.post('/login', authLimiter, async (req, res) => {
  try {
    if (!SECRET()) {
      // JWT_SECRET wajib ada; tanpa ini jwt.sign akan throw "secretOrPrivateKey must have value"
      console.error('[login] JWT_SECRET tidak terdefinisi di .env');
      return res.status(500).json({ status: 'error', message: 'Konfigurasi server tidak lengkap' });
    }

    const email = str(req.body.email).toLowerCase();
    const password = str(req.body.password);

    if (!email || !password) {
      return res.status(400).json({ status: 'error', message: 'email dan password wajib diisi' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ status: 'error', message: 'Format email tidak valid' });
    }

    const user = await db('users').where({ email }).first();

    // Pesan seragam untuk "email tidak ada" dan "password salah".
    // Dulu dibedakan ('Email tidak terdaftar' vs 'Password salah'), sehingga
    // siapa pun bisa menyisir daftar email yang punya akun di sini.
    //
    // bcrypt.compare tetap dijalankan walau user tidak ada, memakai hash dummy.
    // Tanpa ini responsnya balik jauh lebih cepat saat email tidak terdaftar,
    // dan selisih waktu itu sendiri sudah membocorkan jawabannya.
    const hashToCompare = user ? user.password_hash : DUMMY_HASH;
    const valid = await bcrypt.compare(password, hashToCompare);

    if (!user || !valid) {
      return res.status(401).json({ status: 'error', message: 'Email atau password salah' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      SECRET(),
      { expiresIn: '7d' }
    );

    const { password_hash: _, ...profile } = user;
    res.json({ status: 'success', token, data: profile });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ status: 'error', message: 'Gagal login' });
  }
});

module.exports = router;
