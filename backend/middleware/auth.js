const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Format: "Bearer <token>"

    if (!token) return res.status(403).json({ status: "error", message: "Akses ditolak: Token tidak disediakan!" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'rahasia_perpustakaan_ucup');
        req.user = decoded;
        next(); // Lolos validasi, lanjutkan ke rute utama
    } catch (err) {
        return res.status(401).json({ status: "error", message: "Sesi tidak valid atau telah kadaluarsa!" });
    }
};

module.exports = verifyToken;