/**
 * ucup-edu-lib :: Fields Routes
 * GET /api/fields              → List semua bidang (is_active=1, ordered by sort_order)
 * GET /api/fields/:slug        → Detail satu bidang + sub-bidang
 */

const express = require('express');
const router = express.Router();
const db = require('../models/db');

// GET /api/fields
router.get('/', async (req, res) => {
  try {
    const fields = await db('fields')
      .where('is_active', 1)
      .orderBy('sort_order', 'asc');
    res.json({ status: 'success', data: fields, meta: { total: fields.length } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data fields' });
  }
});

// GET /api/fields/:slug  →  field + sub_fields di dalamnya
router.get('/:slug', async (req, res) => {
  try {
    const field = await db('fields')
      .where({ slug: req.params.slug, is_active: 1 })
      .first();
    if (!field) {
      return res.status(404).json({ status: 'error', message: 'Field tidak ditemukan' });
    }
    const sub_fields = await db('sub_fields')
      .where('field_id', field.id)
      .orderBy('sort_order', 'asc');
    res.json({ status: 'success', data: { ...field, sub_fields }, meta: {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data field' });
  }
});

module.exports = router;
