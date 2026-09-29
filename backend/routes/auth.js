/**
 * ucup-edu-lib :: Auth Routes (Member/Siswa)
 * POST /api/auth/register
 * POST /api/auth/login
 */

const router = require('express').Router();
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../models/db');
const {
  authLimiter,
  registerLimiter,
  forgotPasswordLimiter,
  resetPasswordLimiter,
} = require('../middleware/rateLimiters');
const { getPasswordResetConfig, sendPasswordResetEmail } = require('../utils/mailer');

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

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const FORGOT_MIN_RESPONSE_MS = process.env.NODE_ENV === 'test' ? 0 : 500;
const FORGOT_SUCCESS = {
  status: 'success',
  message: 'Jika email terdaftar, instruksi reset password akan dikirim. Periksa inbox dan folder spam.',
};
const RESET_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const RESET_ERROR = 'Token reset tidak valid atau telah kadaluarsa';

const delayUntil = async (startedAt, minimumMs) => {
  const remaining = minimumMs - (Date.now() - startedAt);
  if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
};

const deliverPasswordResetEmail = async ({ user, tokenHash, resetUrl }) => {
  try {
    await sendPasswordResetEmail({ to: user.email, resetUrl });
  } catch (err) {
    // Network timeouts are ambiguous: Resend may have accepted the message
    // before the connection failed, so keep the token available in that case.
    // Definite provider rejection removes the unused token instead.
    if (!err.retryable) {
      await db('password_reset_tokens').where({ token_hash: tokenHash }).del().catch(() => {});
    }
    console.error('[forgot-password] pengiriman email gagal:', err.code || err.name, err.status || '');
  }
};

// POST /api/auth/forgot-password
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const startedAt = Date.now();
  const config = getPasswordResetConfig();
  if (!config) {
    console.error('[forgot-password] konfigurasi email belum lengkap');
    return res.status(503).json({ status: 'error', message: 'Layanan reset password belum tersedia' });
  }

  const email = str(req.body?.email).toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return res.status(400).json({ status: 'error', message: 'Format email tidak valid' });
  }

  // Kerja kriptografi dilakukan untuk email terdaftar maupun tidak agar jalur
  // cepat tidak langsung membocorkan keberadaan akun.
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  try {
    const user = await db('users').where({ email }).first('id', 'email');
    if (user) {
      await db.transaction(async (trx) => {
        // PostgreSQL perlu mengunci baris user agar dua request bersamaan tidak
        // sama-sama menghapus keadaan lama lalu menyisakan dua token aktif.
        await trx('users').where({ id: user.id }).forUpdate().first('id');
        await trx('password_reset_tokens')
          .where({ user_id: user.id })
          .whereNull('used_at')
          .del();
        await trx('password_reset_tokens').insert({
          user_id: user.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        });
      });

      const resetUrl = new URL('/reset-password', config.resetBaseUrl);
      resetUrl.searchParams.set('token', rawToken);
      // Jangan menunggu latency provider sebelum mengirim respons generic.
      void deliverPasswordResetEmail({ user, tokenHash, resetUrl: resetUrl.toString() });
    }
  } catch (err) {
    // Respons tetap generik: error internal pada jalur akun terdaftar tidak boleh
    // berubah menjadi oracle keberadaan akun.
    console.error('[forgot-password] proses gagal:', err.code || err.name);
  }

  await delayUntil(startedAt, FORGOT_MIN_RESPONSE_MS);
  return res.json(FORGOT_SUCCESS);
});

// POST /api/auth/reset-password
router.post('/reset-password', resetPasswordLimiter, async (req, res) => {
  const token = str(req.body?.token);
  const password = str(req.body?.password);

  if (!RESET_TOKEN_RE.test(token)) {
    return res.status(400).json({ status: 'error', message: RESET_ERROR });
  }
  if (password.length < 6) {
    return res.status(400).json({ status: 'error', message: 'Password minimal 6 karakter' });
  }
  if (Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ status: 'error', message: 'Password maksimal 72 byte' });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await db.transaction(async (trx) => {
      const now = new Date();
      const claimed = await trx('password_reset_tokens')
        .where({ token_hash: tokenHash })
        .whereNull('used_at')
        .andWhere('expires_at', '>', now)
        .update({ used_at: now });
      if (claimed !== 1) {
        const error = new Error(RESET_ERROR);
        error.code = 'RESET_TOKEN_INVALID';
        throw error;
      }

      const resetToken = await trx('password_reset_tokens')
        .where({ token_hash: tokenHash })
        .first('user_id');
      if (!resetToken) {
        const error = new Error(RESET_ERROR);
        error.code = 'RESET_TOKEN_INVALID';
        throw error;
      }

      const updated = await trx('users')
        .where({ id: resetToken.user_id })
        .update({
          password_hash: passwordHash,
          session_version: trx.raw('?? + 1', ['session_version']),
        });
      if (updated !== 1) {
        const error = new Error(RESET_ERROR);
        error.code = 'RESET_TOKEN_INVALID';
        throw error;
      }
    });

    return res.json({ status: 'success', message: 'Password berhasil direset' });
  } catch (err) {
    if (err.code === 'RESET_TOKEN_INVALID') {
      return res.status(400).json({ status: 'error', message: RESET_ERROR });
    }
    console.error('[reset-password] proses gagal:', err.code || err.name);
    return res.status(500).json({ status: 'error', message: 'Gagal mereset password' });
  }
});

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
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ status: 'error', message: 'Password maksimal 72 byte' });
    }

    const existing = await db('users').where({ email }).first();
    if (existing) {
      return res.status(409).json({ status: 'error', message: 'Email sudah terdaftar' });
    }

    const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
    // Unique constraint menyelesaikan race dua request dengan email yang sama.
    const [created] = await db('users').insert({ email, password_hash, full_name })
      .onConflict('email').ignore().returning('id');
    if (!created) return res.status(409).json({ status: 'error', message: 'Email sudah terdaftar' });
    const id = created.id;
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
    if (Buffer.byteLength(password, 'utf8') > 72) {
      return res.status(400).json({ status: 'error', message: 'Password maksimal 72 byte' });
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
      { id: user.id, email: user.email, role: user.role, sv: user.session_version ?? 0 },
      SECRET(),
      { expiresIn: '7d' }
    );

    const { password_hash: _, session_version: __, ...profile } = user;
    res.json({ status: 'success', token, data: profile });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ status: 'error', message: 'Gagal login' });
  }
});

module.exports = router;
