/**
 * ucup-edu-lib :: Express Entry Point
 * REST API untuk Perpustakaan Digital Kompas Karier & Minat
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware dasar
app.use(cors());
app.use(express.json());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount routes
const fieldsRouter = require('./routes/fields');
const subfieldsRouter = require('./routes/subfields');
const contentsRouter = require('./routes/contents');
const adminRouter = require('./routes/admin');

app.use('/api/fields', fieldsRouter);
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