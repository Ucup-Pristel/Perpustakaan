/**
 * ucup-edu-lib :: Contents Routes (Public - Read)
 * GET /api/contents              → List semua konten (with pagination)
 * GET /api/contents/search       → Search (?q=...&level=...)   -- harus SEBELUM /:id
 * GET /api/contents/:id          → Detail konten
 */

const express = require('express');
const router = express.Router();
const db = require('../models/db');

const r2Base = () => process.env.R2_PUBLIC_URL || '';

const formatContent = (c) => ({
  ...c,
  file_url: c.file_url ? `${r2Base()}${c.file_url}` : null,
  tags: c.tags ? JSON.parse(c.tags) : [],
});

// GET /api/contents?page=1&limit=20
router.get('/', async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const [{ total }] = await db('contents').count('id as total');
    const contents = await db('contents')
      .orderBy(['level', 'id'])
      .limit(limit)
      .offset(offset);

    res.json({
      status: 'success',
      data: contents.map(formatContent),
      meta: { page, limit, total: Number(total), total_pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil konten' });
  }
});

// GET /api/contents/search?q=marketing&level=2
// PENTING: deklarasi SEBELUM /:id agar Express tidak salah parse "search" sebagai :id
router.get('/search', async (req, res) => {
  try {
    const { q, level } = req.query;
    if (!q) return res.status(400).json({ status: 'error', message: 'Parameter q diperlukan' });

    let query = db('contents').where(function () {
      this.where('title', 'like', `%${q}%`)
        .orWhere('author', 'like', `%${q}%`)
        .orWhere('tags', 'like', `%${q}%`);
    });

    if (level) {
      const levels = level.split(',').map(Number).filter(n => n >= 1 && n <= 4);
      if (levels.length) query = query.whereIn('level', levels);
    }

    const results = await query.orderBy(['level', 'id']);
    res.json({ status: 'success', data: results.map(formatContent), meta: { total: results.length } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal melakukan pencarian' });
  }
});

// GET /api/contents/:id
router.get('/:id', async (req, res) => {
  try {
    const content = await db('contents')
      .join('sub_fields', 'contents.sub_field_id', 'sub_fields.id')
      .join('fields', 'sub_fields.field_id', 'fields.id')
      .select(
        'contents.*',
        'sub_fields.name as sub_field_name',
        'sub_fields.slug as sub_field_slug',
        'fields.name as field_name',
        'fields.slug as field_slug'
      )
      .where('contents.id', req.params.id)
      .first();

    if (!content) {
      return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });
    }

    // Increment read_count — fire and forget, non-blocking
    db('contents').where('id', content.id).increment('read_count', 1).catch(() => {});

    res.json({ status: 'success', data: formatContent(content), meta: {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil konten' });
  }
});

module.exports = router;

