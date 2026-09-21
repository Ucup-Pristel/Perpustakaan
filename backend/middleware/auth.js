const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

  if (!token) return res.status(403).json({ status: "error", message: "Akses ditolak: Token tidak disediakan!" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next(); // Lolos validasi, lanjutkan ke rute utama
  } catch (err) {
    return res.status(401).json({ status: "error", message: "Sesi tidak valid atau telah kadaluarsa!" });
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
