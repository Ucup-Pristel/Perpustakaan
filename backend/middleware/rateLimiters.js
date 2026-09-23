/**
 * ucup-edu-lib :: Rate limiters
 * globalLimiter — semua route, 100 req/15m per IP
 * authLimiter   — /api/auth/login, 5 req/15m per IP (anti brute-force)
 * uploadLimiter — /api/admin/upload, 10 req/jam per IP (anti spam R2)
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
const uploadLimiter = makeLimiter(60 * 60 * 1000, 10, 'Batas upload tercapai, coba lagi nanti.');

module.exports = { globalLimiter, authLimiter, uploadLimiter };
