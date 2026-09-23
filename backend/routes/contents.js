/**
 * ucup-edu-lib :: Contents Routes (Public - Read)
 * GET /api/contents              → List semua konten (with pagination)
 * GET /api/contents/search       → Search (?q=...&level=...)   -- harus SEBELUM /:id
 * GET /api/contents/:id          → Detail konten
 */

const express = require('express');
const router = express.Router();
const db = require('../models/db');

// formatContent dipindah ke helpers/contentUrls.js — logikanya dipakai juga oleh
// subfields.js dan /api/search, dan versi terpisah sudah pernah drift (cover_url
// tidak ikut di-prefix, file_url pernah dobel-prefix).
const { formatContent } = require('../helpers/contentUrls');

// Math.min(100, parseInt('-1')) = -1, dan SQLite menganggap `LIMIT -1` = tanpa
// batas — caller bisa menarik seluruh tabel. Validasi harus menolak eksplisit,
// bukan clamp satu sisi. Mengembalikan null = input invalid.
const parseIntInRange = (raw, { min, max, fallback }) => {
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(String(raw).trim())) return null; // tolak '-1', '1.5', 'abc'
  const n = Number(raw);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

// GET /api/contents?page=1&limit=20&field_id=2
router.get('/', async (req, res) => {
  try {
    const page = parseIntInRange(req.query.page, { min: 1, max: 100000, fallback: 1 });
    if (page === null) {
      return res.status(400).json({ status: 'error', message: 'page harus bilangan bulat ≥ 1' });
    }

    const limit = parseIntInRange(req.query.limit, { min: 1, max: 100, fallback: 20 });
    if (limit === null) {
      return res.status(400).json({ status: 'error', message: 'limit harus bilangan bulat 1-100' });
    }

    const offset = (page - 1) * limit;

    const fieldId = req.query.field_id === undefined || req.query.field_id === ''
      ? null
      : parseIntInRange(req.query.field_id, { min: 1, max: 1000000, fallback: null });
    if (req.query.field_id !== undefined && req.query.field_id !== '' && fieldId === null) {
      return res.status(400).json({ status: 'error', message: 'field_id tidak valid' });
    }

    const base = () => {
      const query = db('contents');
      if (fieldId !== null) {
        query.join('sub_fields', 'contents.sub_field_id', 'sub_fields.id')
          .where('sub_fields.field_id', fieldId)
          .select('contents.*');
      }
      return query;
    };

    const [{ total }] = await base().clearSelect().clearOrder().countDistinct('contents.id as total');
    const contents = await base().orderBy(['contents.level', 'contents.id']).limit(limit).offset(offset);

    res.json({
      status: 'success',
      data: contents.map(formatContent),
      meta: { page, limit, total: Number(total), total_pages: Math.ceil(Number(total) / limit) },
    });
  } catch (err) {
    console.error('[contents:list]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil konten' });
  }
});

// GET /api/contents/search?q=marketing&level=2
// PENTING: deklarasi SEBELUM /:id agar Express tidak salah parse "search" sebagai :id
router.get('/search', async (req, res) => {
  try {
    const { q, level } = req.query;
    if (!q) return res.status(400).json({ status: 'error', message: 'Parameter q diperlukan' });

    // Query sangat panjang hanya membebani LIKE scan tanpa menambah relevansi.
    const term = String(q).trim().slice(0, 100);
    if (!term) return res.status(400).json({ status: 'error', message: 'Parameter q diperlukan' });

    const limit = parseIntInRange(req.query.limit, { min: 1, max: 100, fallback: 50 });
    if (limit === null) {
      return res.status(400).json({ status: 'error', message: 'limit harus bilangan bulat 1-100' });
    }

    let query = db('contents').where(function () {
      this.where('title', 'like', `%${term}%`)
        .orWhere('author', 'like', `%${term}%`)
        .orWhere('tags', 'like', `%${term}%`);
    });

    if (level) {
      const levels = String(level).split(',').map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 4);
      if (levels.length) query = query.whereIn('level', levels);
    }

    // Tanpa limit, route ini mengembalikan seluruh baris yang cocok.
    const results = await query.orderBy(['level', 'id']).limit(limit);
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

