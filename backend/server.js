/**
 * ucup-edu-lib :: Express Entry Point
 * REST API untuk Perpustakaan Digital Kompas Karier & Minat
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth');
const { isAdmin } = require('./middleware/auth');
const db = require('./models/db');
const { deleteFromR2 } = require('./utils/r2Uploader');
const Fuse = require('fuse.js');
const queryParser = require('./helpers/queryParser');
const { globalLimiter } = require('./middleware/rateLimiters');

const app = express();
const PORT = process.env.PORT || 3000;

// Percaya TEPAT satu hop (Nginx), bukan `true`.
// `true` = percaya semua proxy: klien bisa mengarang X-Forwarded-For, req.ip jadi
// palsu, dan authLimiter (5 login/15m) bisa dilewati dengan memutar IP.
// express-rate-limit menolak `true` dengan ERR_ERL_PERMISSIVE_TRUST_PROXY.
// Angka 1 hanya aman kalau Node TIDAK bisa dihubungi langsung dari internet —
// karena itu server bind ke loopback di bawah, dan Nginx wajib memakai
// `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` (append, bukan
// menimpa dengan nilai kiriman klien).
app.set('trust proxy', 1);

// Middleware dasar
app.use(helmet());
const allowedOrigins = (process.env.FRONTEND_URL || 'https://edulib.id,https://www.edulib.id')
  .split(',')
  .map(o => o.trim());
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));
app.use(globalLimiter);
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// GET /api/search?q=...
app.get('/api/search', async (req, res) => {
  try {
    // queryParser mengembalikan varian query (asli + hasil substitusi sinonim
    // dua arah, mis. "computer" -> juga coba "komputer"). Ini menutup gap
    // typo-tolerance Fuse.js yang cuma efektif untuk salah ketik, bukan kata
    // yang beda total (computer vs komputer bukan typo, tapi sinonim istilah).
    const queryVariants = queryParser(req.query.q);
    if (!queryVariants.length) return res.status(400).json({ status: 'error', message: 'Parameter q diperlukan' });

    const contents = await db('contents as content')
      .leftJoin('sub_fields as subfield', 'content.sub_field_id', 'subfield.id')
      .leftJoin('fields as field', 'subfield.field_id', 'field.id')
      .whereNotNull('content.title')
      // cover_url/file_url/source_url ikut diambil: tanpa cover_url kartu hasil
      // pencarian tidak pernah menampilkan sampul, dan tanpa file_url frontend
      // tidak bisa tahu konten mana yang benar-benar bisa dibuka di reader.
      .select('content.id', 'content.title', 'content.author', 'content.description', 'content.level', 'content.content_type', 'content.cover_url', 'content.file_url', 'content.source_url', 'subfield.name as sub_field_name', 'field.name as field_name');

    // Sama seperti formatContent di routes/contents.js: cek skema dulu, kalau
    // tidak URL absolut baru diprefix R2 — kalau tidak, jadi dobel prefix.
    const r2 = process.env.R2_PUBLIC_URL || '';
    const toUrl = (v) => (v ? (/^https?:\/\//.test(v) ? v : `${r2}${v}`) : null);

    const searchable = contents.map(content => ({
      ...content,
      cover_url: toUrl(content.cover_url),
      file_url: toUrl(content.file_url),
      description: [content.description, content.sub_field_name, content.field_name].filter(Boolean).join(' '),
    }));
    const fuse = new Fuse(searchable, {
      keys: ['title', 'author', 'description'],
      threshold: 0.4,
      ignoreLocation: true,
      distance: 100,
      includeScore: true,
    });

    // Cari tiap varian, simpan skor terbaik per item (skor lebih kecil = lebih relevan di Fuse).
    const best = new Map();
    for (const term of queryVariants) {
      for (const { item, score } of fuse.search(term)) {
        const prev = best.get(item.id);
        if (!prev || score < prev.score) best.set(item.id, { item, score });
      }
    }
    const results = [...best.values()].sort((a, b) => a.score - b.score).map(r => r.item);

    res.json({ status: 'success', data: results, meta: { query: queryVariants[0], total: results.length } });
  } catch (err) {
    console.error('[search]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mencari konten' });
  }
});

// Mount routes
const authRouter      = require('./routes/auth');
const activityRouter  = require('./routes/activity');
const fieldsRouter    = require('./routes/fields');
const subfieldsRouter = require('./routes/subfields');
const contentsRouter = require('./routes/contents');
const adminRouter = require('./routes/admin');

app.use('/api/auth', authRouter);
app.use('/api/activity', activityRouter);
app.use('/api/fields', fieldsRouter);

// POST /api/fields — protected
app.post('/api/fields', auth, isAdmin, async (req, res) => {
  try {
    const { slug, name, description, icon, color, sort_order, is_active } = req.body;
    const [id] = await db('fields').insert({ slug, name, description, icon, color, sort_order, is_active });
    res.status(201).json({ status: 'success', message: 'Field berhasil ditambahkan', data: { id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan field' });
  }
});

// PUT /api/fields/:id — protected
app.put('/api/fields/:id', auth, isAdmin, async (req, res) => {
  try {
    const { slug, name, description, icon, color, sort_order, is_active } = req.body;
    const count = await db('fields').where('id', req.params.id).update({ slug, name, description, icon, color, sort_order, is_active });
    if (!count) return res.status(404).json({ status: 'error', message: 'Field tidak ditemukan' });
    res.json({ status: 'success', message: 'Field berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui field' });
  }
});

// DELETE /api/fields/:id — protected
app.delete('/api/fields/:id', auth, isAdmin, async (req, res) => {
  try {
    const count = await db('fields').where('id', req.params.id).del();
    if (!count) return res.status(404).json({ status: 'error', message: 'Field tidak ditemukan' });
    res.json({ status: 'success', message: 'Field berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus field' });
  }
});

app.use('/api/subfields', subfieldsRouter);

// POST /api/subfields — protected
app.post('/api/subfields', auth, isAdmin, async (req, res) => {
  try {
    const { field_id, slug, name, description, parent_id, sort_order } = req.body;
    const [id] = await db('sub_fields').insert({ field_id, slug, name, description, parent_id, sort_order });
    res.status(201).json({ status: 'success', message: 'Sub-bidang berhasil ditambahkan', data: { id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan sub-bidang' });
  }
});

// PUT /api/subfields/:id — protected
app.put('/api/subfields/:id', auth, isAdmin, async (req, res) => {
  try {
    const { field_id, slug, name, description, parent_id, sort_order } = req.body;
    const count = await db('sub_fields').where('id', req.params.id).update({ field_id, slug, name, description, parent_id, sort_order });
    if (!count) return res.status(404).json({ status: 'error', message: 'Sub-bidang tidak ditemukan' });
    res.json({ status: 'success', message: 'Sub-bidang berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui sub-bidang' });
  }
});

// DELETE /api/subfields/:id — protected
app.delete('/api/subfields/:id', auth, isAdmin, async (req, res) => {
  try {
    const count = await db('sub_fields').where('id', req.params.id).del();
    if (!count) return res.status(404).json({ status: 'error', message: 'Sub-bidang tidak ditemukan' });
    res.json({ status: 'success', message: 'Sub-bidang berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus sub-bidang' });
  }
});

app.use('/api/contents', contentsRouter);

// POST /api/contents — protected
app.post('/api/contents', auth, isAdmin, async (req, res) => {
  try {
    const { sub_field_id, title, author, description, level, content_type, source_url, file_url, cover_url, tags, language, page_count, duration, difficulty_score, is_featured, created_at, updated_at } = req.body;
    const [id] = await db('contents').insert({ sub_field_id, title, author, description, level, content_type, source_url, file_url, cover_url, tags, language, page_count, duration, difficulty_score, is_featured, created_at, updated_at });
    res.status(201).json({ status: 'success', message: 'Konten berhasil ditambahkan', data: { id } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal menambahkan konten' });
  }
});

// PUT /api/contents/:id — protected
app.put('/api/contents/:id', auth, isAdmin, async (req, res) => {
  try {
    const { sub_field_id, title, author, description, level, content_type, source_url, file_url, cover_url, tags, language, page_count, duration, difficulty_score, is_featured, updated_at } = req.body;
    const count = await db('contents').where('id', req.params.id).update({ sub_field_id, title, author, description, level, content_type, source_url, file_url, cover_url, tags, language, page_count, duration, difficulty_score, is_featured, updated_at });
    if (!count) return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });
    res.json({ status: 'success', message: 'Konten berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui konten' });
  }
});

// DELETE /api/contents/:id — protected
app.delete('/api/contents/:id', auth, isAdmin, async (req, res) => {
  try {
    const row = await db('contents').where('id', req.params.id).first('file_url', 'cover_url');
    if (!row) return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });

    // Hapus file fisik di R2 dulu — kalau gagal (bukan 404), jangan lanjut hapus baris DB
    await deleteFromR2(row.file_url);
    await deleteFromR2(row.cover_url);

    await db('contents').where('id', req.params.id).del();
    res.json({ status: 'success', message: 'Konten berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus konten' });
  }
});

app.use('/api/admin', adminRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: 'error', message: 'Endpoint tidak ditemukan' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: 'error', message: 'Internal server error' });
});

// Hanya listen kalau file ini dijalankan langsung (`node backend/server.js`).
// Sebelumnya listen berjalan saat module di-require, jadi `node --test` mewarisi
// listener yang tidak pernah ditutup dan proses test menggantung selamanya.
if (require.main === module) {
  // Bind ke loopback secara default. `trust proxy: 1` hanya aman kalau satu-satunya
  // yang bisa menghubungi Node adalah Nginx — kalau port ini terbuka ke internet,
  // klien bisa mengirim X-Forwarded-For sendiri dan memalsukan req.ip.
  // Override lewat HOST=0.0.0.0 hanya untuk container yang sudah punya batas jaringan.
  const HOST = process.env.HOST || '127.0.0.1';
  app.listen(PORT, HOST, () => {
    console.log(`[ucup-edu-lib] API running on http://${HOST}:${PORT}`);
  });
}

module.exports = app;

// Test Trigger CI/CD