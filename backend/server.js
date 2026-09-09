/**
 * ucup-edu-lib :: Express Entry Point
 * REST API untuk Perpustakaan Digital Kompas Karier & Minat
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const auth = require('./middleware/auth');
const db = require('./models/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware dasar
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (username !== 'admin' || password !== 'admin123') {
    return res.status(401).json({ status: 'error', message: 'Username atau password salah' });
  }
  const token = jwt.sign({ username }, process.env.JWT_SECRET || 'rahasia_perpustakaan_ucup', { expiresIn: '2h' });
  res.json({ status: 'success', token });
});

// Mount routes
const fieldsRouter = require('./routes/fields');
const subfieldsRouter = require('./routes/subfields');
const contentsRouter = require('./routes/contents');
const adminRouter = require('./routes/admin');

app.use('/api/fields', fieldsRouter);

// POST /api/fields — protected
app.post('/api/fields', auth, async (req, res) => {
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
app.put('/api/fields/:id', auth, async (req, res) => {
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
app.delete('/api/fields/:id', auth, async (req, res) => {
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
app.use('/api/contents', contentsRouter);
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

app.listen(PORT, () => {
  console.log(`[ucup-edu-lib] API running on http://localhost:${PORT}`);
});

module.exports = app;

// Test CI/CD deployment otomatis