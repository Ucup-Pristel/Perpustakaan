const jwt = require('jsonwebtoken');
const db = require('../models/db');

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) return res.status(403).json({ status: "error", message: "Akses ditolak: Token tidak disediakan!" });

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (!Number.isSafeInteger(decoded.id) || decoded.id < 1) throw new Error('Invalid user id');
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Sesi tidak valid atau telah kadaluarsa!" });
  }

  try {
    // JWT membuktikan identitas, bukan role yang masih berlaku tujuh hari kemudian.
    const user = await db('users').where('id', decoded.id).first('id', 'email', 'role', 'session_version');
    if (!user) return res.status(401).json({ status: "error", message: "Sesi tidak valid atau telah kadaluarsa!" });
    // JWT lama tidak memiliki `sv`; selama nilai DB masih 0, perlakukan sebagai
    // versi 0 agar deploy fitur ini tidak logout semua pengguna sekaligus.
    const tokenSessionVersion = decoded.sv === undefined ? 0 : decoded.sv;
    const currentSessionVersion = user.session_version ?? 0;
    if (!Number.isSafeInteger(tokenSessionVersion) || tokenSessionVersion < 0 || tokenSessionVersion !== currentSessionVersion) {
      return res.status(401).json({ status: "error", message: "Sesi tidak valid atau telah kadaluarsa!" });
    }
    const { session_version: _, ...requestUser } = user;
    req.user = requestUser;
    next();
  } catch (err) {
    next(err);
  }
};

// Wajib dipasang setelah verifyToken — cek req.user.role
const isAdmin = (req, res, next) => {
  if (!req.user) return res.status(403).json({ status: "error", message: "Akses ditolak: Token tidak disediakan!" });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ status: "error", message: "Akses ditolak: hanya admin yang diizinkan!" });
  }
  next();
};

module.exports = verifyToken;
module.exports.verifyToken = verifyToken;
module.exports.isAdmin = isAdmin;
