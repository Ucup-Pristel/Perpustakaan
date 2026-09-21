/**
 * backend/routes/admin.js
 * GET    /api/admin/contents    — daftar semua konten
 * POST   /api/admin/upload      — upload PDF + cover ke R2, insert SQLite
 * DELETE /api/admin/contents/:id
 */

const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const path     = require('path');
const auth     = require('../middleware/auth');
const { isAdmin } = require('../middleware/auth');
const db       = require('../models/db');
const { uploadToR2, deleteFromR2 } = require('../utils/r2Uploader');
const { uploadLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

const TMP_DIR = path.resolve(__dirname, '../../tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const diskFilename = (req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}${path.extname(file.originalname)}`);

const upload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: diskFilename }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Tipe file tidak didukung: ${file.mimetype}`));
  },
});

// Multer khusus cover: hanya jpg/jpeg/png, maksimal 2 MB
const coverUpload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: diskFilename }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error(`Format cover harus jpg/jpeg/png, diterima: ${file.mimetype}`));
  },
});

// Semua admin route butuh JWT valid
router.use(auth);

// GET /api/admin/contents — baca saja, tidak perlu isAdmin
router.get('/contents', async (req, res) => {
  try {
    const rows = await db('contents as c')
      .leftJoin('sub_fields as sf', 'c.sub_field_id', 'sf.id')
      .leftJoin('fields as f', 'sf.field_id', 'f.id')
      .orderBy('c.id', 'desc')
      .select(
        'c.id', 'c.title', 'c.author', 'c.content_type',
        'c.level', 'c.file_url', 'c.cover_url', 'c.created_at',
        'sf.name as sub_field_name', 'f.name as field_name',
      );
    res.json({ status: 'success', data: rows });
  } catch (err) {
    console.error('[admin/contents]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data konten' });
  }
});

// Hapus file sementara tanpa melempar error jika sudah tidak ada
function cleanupTmp(...files) {
  for (const f of files) {
    if (!f) continue;
    fs.unlink(f.path, (err) => {
      if (err && err.code !== 'ENOENT') console.error('[admin/upload] gagal hapus tmp:', f.path, err.message);
    });
  }
}

// POST /api/admin/upload
router.post(
  '/upload',
  isAdmin,
  uploadLimiter,
  upload.fields([{ name: 'pdf', maxCount: 1 }, { name: 'cover', maxCount: 1 }]),
  async (req, res) => {
    const pdfFile   = req.files?.pdf?.[0];
    const coverFile = req.files?.cover?.[0];

    try {
      if (!pdfFile) return res.status(400).json({ status: 'error', message: 'File PDF diperlukan' });

      const { title, author, description, sub_field_id, level, language } = req.body;
      if (!title?.trim()) return res.status(400).json({ status: 'error', message: 'Judul diperlukan' });

      // Upload PDF ke folder pdfs/ (stream dari disk, bukan buffer di memori)
      const fileUrl = await uploadToR2(pdfFile.path, pdfFile.originalname, 'pdfs');

      // Upload cover ke folder covers/ (opsional)
      let coverUrl = null;
      if (coverFile) {
        coverUrl = await uploadToR2(coverFile.path, coverFile.originalname, 'covers');
      }

      const [id] = await db('contents').insert({
        title:        title.trim(),
        author:       author?.trim() || null,
        description:  description?.trim() || null,
        sub_field_id: sub_field_id ? Number(sub_field_id) : null,
        level:        level ? Number(level) : 1,
        language:     language?.trim() || 'id',
        content_type: 'pdf',
        file_url:     fileUrl,
        cover_url:    coverUrl,
        created_at:   new Date().toISOString(),
        updated_at:   new Date().toISOString(),
      });

      res.status(201).json({
        status: 'success',
        message: 'Upload berhasil',
        data: { id, file_url: fileUrl, cover_url: coverUrl },
      });
    } catch (err) {
      console.error('[admin/upload]', err);
      res.status(500).json({ status: 'error', message: err.message || 'Upload gagal' });
    } finally {
      cleanupTmp(pdfFile, coverFile);
    }
  },
);

// POST /api/admin/contents/:id/cover — upload/replace cover buku yang sudah ada
router.post(
  '/contents/:id/cover',
  isAdmin,
  uploadLimiter,
  coverUpload.single('cover'),
  async (req, res) => {
    const coverFile = req.file;
    try {
      if (!coverFile) return res.status(400).json({ status: 'error', message: 'File cover diperlukan' });

      const existing = await db('contents').where('id', req.params.id).first('id', 'cover_url');
      if (!existing) return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });

      const coverUrl = await uploadToR2(coverFile.path, coverFile.originalname, 'covers');

      await db('contents').where('id', req.params.id).update({
        cover_url: coverUrl,
        updated_at: new Date().toISOString(),
      });

      // Hapus cover lama di R2 (best-effort, tidak boleh gagalkan response sukses)
      if (existing.cover_url) {
        deleteFromR2(existing.cover_url).catch(err => console.error('[admin/cover] gagal hapus cover lama:', err.message));
      }

      res.json({ status: 'success', message: 'Cover berhasil diperbarui', data: { id: existing.id, cover_url: coverUrl } });
    } catch (err) {
      console.error('[admin/cover]', err);
      res.status(500).json({ status: 'error', message: err.message || 'Upload cover gagal' });
    } finally {
      cleanupTmp(coverFile);
    }
  },
);

// DELETE /api/admin/contents/:id
router.delete('/contents/:id', isAdmin, async (req, res) => {
  try {
    const row = await db('contents').where('id', req.params.id).first('file_url', 'cover_url');
    if (!row) return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });

    // Hapus file fisik di R2 dulu — kalau gagal (bukan 404), jangan lanjut hapus baris DB
    await deleteFromR2(row.file_url);
    await deleteFromR2(row.cover_url);

    await db('contents').where('id', req.params.id).del();
    res.json({ status: 'success', message: 'Konten dihapus' });
  } catch (err) {
    console.error('[admin/delete]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus konten' });
  }
});

// Error handler khusus router ini — tangkap error dari multer (fileFilter,
// limit ukuran) dan kembalikan 400 dengan pesan jelas, bukan 500 generik.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Tipe file') || err.message?.startsWith('Format cover')) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
  next(err);
});

module.exports = router;
