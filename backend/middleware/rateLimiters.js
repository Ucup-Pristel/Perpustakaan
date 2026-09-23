/**
 * ucup-edu-lib :: Rate limiters
 * globalLimiter   — semua route, 500 req/15m per IP
 * authLimiter     — /api/auth/login, 5 req/15m per IP (anti brute-force)
 * registerLimiter — /api/auth/register, 10 req/jam per IP
 * uploadLimiter   — /api/admin/upload, 10 req/jam per IP (anti spam R2)
 *
 * Semua limiter bergantung pada req.ip yang benar. req.ip ditentukan oleh
 * `app.set('trust proxy', 1)` di server.js + header X-Forwarded-For dari Nginx;
 * kalau salah satunya salah, seluruh limiter di file ini jadi tidak berguna.
 */
const rateLimit = require('express-rate-limit');

const makeLimiter = (windowMs, max, message) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { status: 'error', message },
  });

const globalLimiter = makeLimiter(15 * 60 * 1000, 500, 'Terlalu banyak request, coba lagi nanti.');
const authLimiter = makeLimiter(15 * 60 * 1000, 5, 'Terlalu banyak percobaan login, coba lagi nanti.');
// Register juga perlu dibatasi: tiap panggilan menjalankan bcrypt.hash (mahal di
// CPU) dan membuat baris users baru, jadi tanpa limiter endpoint ini bisa dipakai
// untuk spam akun sekaligus membebani server.
const registerLimiter = makeLimiter(60 * 60 * 1000, 10, 'Terlalu banyak pendaftaran dari jaringan ini, coba lagi nanti.');
const uploadLimiter = makeLimiter(60 * 60 * 1000, 10, 'Batas upload tercapai, coba lagi nanti.');

module.exports = { globalLimiter, authLimiter, registerLimiter, uploadLimiter };
