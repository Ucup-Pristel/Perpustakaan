/**
 * ucup-edu-lib :: Admin Routes (Protected by JWT - Fase 3)
 * POST   /api/admin/contents     → Tambah konten baru
 * PUT    /api/admin/contents/:id → Update konten
 * DELETE /api/admin/contents/:id → Hapus konten
 */

const express = require('express');
const router = express.Router();
const db = require('../models/db');

// Middleware auth placeholder (implementasi JWT di Fase 3)
const requireAuth = (req, res, next) => {
  // TODO: verify JWT token
  // const token = req.headers.authorization?.split(' ')[1];
  // if (!token) return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  next();
};

router.use(requireAuth);

// POST /api/admin/contents
router.post('/contents', async (req, res) => {
  // TODO: implementasi
  res.json({ status: 'success', data: null, meta: {} });
});

// PUT /api/admin/contents/:id
router.put('/contents/:id', async (req, res) => {
  // TODO: implementasi
  res.json({ status: 'success', data: null, meta: {} });
});

// DELETE /api/admin/contents/:id
router.delete('/contents/:id', async (req, res) => {
  // TODO: implementasi
  res.json({ status: 'success', data: null, meta: {} });
});

module.exports = router;
