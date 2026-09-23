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

// Mimetype per FIELD, bukan satu daftar gabungan. Sebelumnya filter yang sama
// dipakai untuk 'pdf' dan 'cover', jadi JPEG bisa dikirim sebagai field 'pdf'
// dan tersimpan dengan content_type 'pdf' — konten rusak di reader.
const FIELD_MIMES = {
  pdf: ['application/pdf'],
  cover: ['image/jpeg', 'image/png'],
};

// Signature/magic bytes — mimetype berasal dari client dan bisa dipalsukan.
const SIGNATURES = {
  'application/pdf': [Buffer.from('%PDF-')],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
};

// Baca beberapa byte awal dan cocokkan dengan signature yang diizinkan.
function verifySignature(filePath, allowedMimes) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const head = Buffer.alloc(8);
    const read = fs.readSync(fd, head, 0, 8, 0);
    return allowedMimes.some((m) =>
      (SIGNATURES[m] || []).some((sig) => read >= sig.length && head.subarray(0, sig.length).equals(sig)),
    );
  } finally {
    fs.closeSync(fd);
  }
}

// Error yang harus jadi 400, bukan 500. Ditandai lewat properti — error handler
// di bawah TIDAK boleh mencocokkan teks pesan, karena pesan berubah dan
// mismatch-nya diam-diam mengubah 400 jadi 500.
const badFile = (message) => Object.assign(new Error(message), { status: 400 });

const upload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: diskFilename }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB per file
  fileFilter: (req, file, cb) => {
    const allowed = FIELD_MIMES[file.fieldname];
    if (!allowed) return cb(badFile(`Field file tidak dikenal: ${file.fieldname}`));
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(badFile(`Field ${file.fieldname} menolak tipe ${file.mimetype}`));
  },
});

// Multer khusus cover: hanya jpg/jpeg/png, maksimal 2 MB
const coverUpload = multer({
  storage: multer.diskStorage({ destination: TMP_DIR, filename: diskFilename }),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (req, file, cb) => {
    if (FIELD_MIMES.cover.includes(file.mimetype)) cb(null, true);
    else cb(badFile(`Format cover harus jpg/png, diterima: ${file.mimetype}`));
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

      // Mimetype bisa dipalsukan client — cek magic bytes sebelum kirim ke R2.
      if (!verifySignature(pdfFile.path, FIELD_MIMES.pdf)) {
        return res.status(400).json({ status: 'error', message: 'File bukan PDF yang valid' });
      }
      if (coverFile && !verifySignature(coverFile.path, FIELD_MIMES.cover)) {
        return res.status(400).json({ status: 'error', message: 'Cover bukan JPG/PNG yang valid' });
      }

      const { title, author, description, sub_field_id, level, language } = req.body;
      if (!title?.trim()) return res.status(400).json({ status: 'error', message: 'Judul diperlukan' });

      // Metadata divalidasi SEBELUM upload — gagal di sini berarti tidak ada
      // object yatim di R2 yang perlu dibersihkan.
      let subFieldId = null;
      if (sub_field_id !== undefined && String(sub_field_id).trim() !== '') {
        subFieldId = Number(sub_field_id);
        if (!Number.isInteger(subFieldId) || subFieldId < 1) {
          return res.status(400).json({ status: 'error', message: 'sub_field_id tidak valid' });
        }
        // FK aktif di DB: insert dengan sub_field_id asing akan gagal setelah
        // file sudah terkirim ke R2, jadi dicek lebih dulu.
        const exists = await db('sub_fields').where('id', subFieldId).first('id');
        if (!exists) {
          return res.status(400).json({ status: 'error', message: 'sub_field_id tidak ditemukan' });
        }
      }

      let levelNum = 1;
      if (level !== undefined && String(level).trim() !== '') {
        levelNum = Number(level);
        if (!Number.isInteger(levelNum) || levelNum < 1 || levelNum > 4) {
          return res.status(400).json({ status: 'error', message: 'level harus 1-4' });
        }
      }

      const lang = language?.trim() || 'id';
      if (!['id', 'en'].includes(lang)) {
        return res.status(400).json({ status: 'error', message: "language harus 'id' atau 'en'" });
      }

      // Lacak object yang sudah masuk R2 supaya bisa dibersihkan kalau langkah
      // berikutnya gagal. Tanpa ini, cover/DB yang gagal meninggalkan file yatim
      // di bucket yang tidak direferensikan baris mana pun.
      const uploaded = [];
      try {
        const fileUrl = await uploadToR2(pdfFile.path, pdfFile.originalname, 'pdfs');
        uploaded.push(fileUrl);

        let coverUrl = null;
        if (coverFile) {
          coverUrl = await uploadToR2(coverFile.path, coverFile.originalname, 'covers');
          uploaded.push(coverUrl);
        }

        const [id] = await db('contents').insert({
          title:        title.trim().slice(0, 255),
          author:       author?.trim().slice(0, 255) || null,
          description:  description?.trim() || null,
          sub_field_id: subFieldId,
          level:        levelNum,
          language:     lang,
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
        // Compensating cleanup: hapus object yang sudah terkirim, lalu lempar
        // ulang supaya handler luar yang membalas error.
        for (const url of uploaded) {
          await deleteFromR2(url).catch((e) =>
            console.error('[admin/upload] rollback R2 gagal:', url, e.message));
        }
        throw err;
      }
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

      // Mimetype berasal dari client dan bisa dipalsukan — cek magic bytes,
      // sama seperti /upload. Tanpa ini file apa pun bisa masuk bucket dengan
      // hanya menyetel Content-Type: image/png.
      if (!verifySignature(coverFile.path, FIELD_MIMES.cover)) {
        return res.status(400).json({ status: 'error', message: 'Cover bukan JPG/PNG yang valid' });
      }

      const existing = await db('contents').where('id', req.params.id).first('id', 'cover_url');
      if (!existing) return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });

      const coverUrl = await uploadToR2(coverFile.path, coverFile.originalname, 'covers');

      try {
        await db('contents').where('id', req.params.id).update({
          cover_url: coverUrl,
          updated_at: new Date().toISOString(),
        });
      } catch (err) {
        // DB gagal setelah file masuk R2: buang object baru itu, kalau tidak
        // bucket menyimpan file yang tidak direferensikan baris mana pun.
        await deleteFromR2(coverUrl).catch(e =>
          console.error('[admin/cover] rollback R2 gagal:', coverUrl, e.message));
        throw err;
      }

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
  // err.status ditandai oleh badFile(); jangan cocokkan teks pesan — pesan
  // berubah dan mismatch-nya diam-diam mengubah 400 jadi 500.
  if (err instanceof multer.MulterError || err.status === 400) {
    return res.status(400).json({ status: 'error', message: err.message });
  }
  next(err);
});

module.exports = router;
