/**
 * ucup-edu-lib :: Subfields Routes
 * GET /api/subfields                      → List semua sub-bidang
 * GET /api/subfields/:slug                → Detail field induk + sub-bidang tersebut
 * GET /api/subfields/:slug/contents       → Konten dalam sub-bidang (?level=1,2,3,4)
 */

const express = require('express');
const router = express.Router();
const db = require('../models/db');
const { formatContent } = require('../helpers/contentUrls');

// GET /api/subfields
router.get('/', async (req, res) => {
  try {
    const subfields = await db('sub_fields')
      .join('fields', 'sub_fields.field_id', 'fields.id')
      .select(
        'sub_fields.*',
        'fields.name as field_name',
        'fields.slug as field_slug',
        'fields.color as field_color'
      )
      .orderBy(['fields.sort_order', 'sub_fields.sort_order']);
    res.json({ status: 'success', data: subfields, meta: { total: subfields.length } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data sub-bidang' });
  }
});

// GET /api/subfields/:slug  →  sub-bidang + field induknya
router.get('/:slug', async (req, res) => {
  try {
    const subfield = await db('sub_fields')
      .join('fields', 'sub_fields.field_id', 'fields.id')
      .select(
        'sub_fields.*',
        'fields.name as field_name',
        'fields.slug as field_slug',
        'fields.color as field_color'
      )
      .where('sub_fields.slug', req.params.slug)
      .first();
    if (!subfield) {
      return res.status(404).json({ status: 'error', message: 'Sub-bidang tidak ditemukan' });
    }
    res.json({ status: 'success', data: subfield, meta: {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil data sub-bidang' });
  }
});

// GET /api/subfields/:slug/contents?level=1,2,3,4
router.get('/:slug/contents', async (req, res) => {
  try {
    const subfield = await db('sub_fields').where('slug', req.params.slug).first();
    if (!subfield) {
      return res.status(404).json({ status: 'error', message: 'Sub-bidang tidak ditemukan' });
    }

    let query = db('contents')
      .where('sub_field_id', subfield.id)
      .orderBy(['level', 'id']);

    // Filter by level: ?level=1 atau ?level=1,2,3
    if (req.query.level !== undefined && typeof req.query.level !== 'string') {
      return res.status(400).json({ status: 'error', message: 'level tidak valid' });
    }
    if (req.query.level) {
      const levels = req.query.level.split(',').map(Number).filter(n => n >= 1 && n <= 4);
      if (levels.length) query = query.whereIn('level', levels);
    }

    const contents = await query;

    // Gabungkan R2 URL — sesuai § 10.4.E: jangan hardcode di DB.
    // Pakai helper bersama: versi lokal di sini pernah dobel-prefix file_url dan
    // tidak pernah memprefix cover_url sama sekali.
    const data = contents.map(formatContent);

    res.json({ status: 'success', data, meta: { total: data.length } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil konten' });
  }
});

module.exports = router;
