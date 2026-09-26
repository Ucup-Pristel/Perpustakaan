/**
 * Aktivitas Reader. Semua rute memakai JWT.
 */
const router = require('express').Router();
const auth = require('../middleware/authMiddleware');
const db = require('../models/db');

function validContentId(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

async function saveProgress(req, res) {
  try {
    const content_id = validContentId(req.body.content_id);
    const last_page = validContentId(req.body.last_page ?? req.body.last_page_read);
    if (!content_id || !last_page) {
      return res.status(400).json({ status: 'error', message: 'content_id dan last_page harus bilangan bulat ≥ 1' });
    }
    if (!await db('contents').where('id', content_id).first('id')) {
      return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });
    }

    const updated_at = new Date().toISOString();
    await db('reading_progress')
      .insert({ user_id: req.user.id, content_id, last_page, updated_at })
      .onConflict(['user_id', 'content_id'])
      .merge({ last_page, updated_at });

    res.json({ status: 'success', data: { user_id: req.user.id, content_id, last_page, updated_at } });
  } catch (err) {
    console.error('[reading-progress:post]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menyimpan progress' });
  }
}

async function getProgress(req, res) {
  try {
    const content_id = validContentId(req.params.content_id);
    if (!content_id) return res.status(400).json({ status: 'error', message: 'content_id tidak valid' });

    const progress = await db('reading_progress').where({ user_id: req.user.id, content_id }).first();
    const last_page = progress?.last_page || 1;
    res.json({ status: 'success', data: { user_id: req.user.id, content_id, last_page, last_page_read: last_page, updated_at: progress?.updated_at || null } });
  } catch (err) {
    console.error('[reading-progress:get]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil progress' });
  }
}

router.post('/reading-progress', auth, saveProgress);
router.get('/reading-progress/:content_id', auth, getProgress);
// Kompatibilitas kontrak Reader lama.
router.post('/progress', auth, saveProgress);
router.get('/progress/:content_id', auth, getProgress);

router.get('/notes/:content_id', auth, async (req, res) => {
  try {
    const content_id = validContentId(req.params.content_id);
    const page_number = req.query.page_number === undefined ? null : validContentId(req.query.page_number);
    if (!content_id || (req.query.page_number !== undefined && !page_number)) {
      return res.status(400).json({ status: 'error', message: 'content_id atau page_number tidak valid' });
    }

    const query = db('notes').where({ user_id: req.user.id, content_id });
    if (page_number !== null) query.where({ page_number });
    const notes = await query.orderBy('page_number', 'asc').select('id', 'content_id', 'page_number', 'note_text', 'created_at', 'updated_at');
    res.json({ status: 'success', data: notes });
  } catch (err) {
    console.error('[notes:get]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil catatan' });
  }
});

router.post('/notes', auth, async (req, res) => {
  try {
    const content_id = validContentId(req.body.content_id);
    const page_number = validContentId(req.body.page_number);
    const note_text = typeof req.body.note_text === 'string' ? req.body.note_text.trim() : '';
    if (!content_id || !page_number || !note_text) {
      return res.status(400).json({ status: 'error', message: 'content_id, page_number, dan note_text wajib valid' });
    }
    if (!await db('contents').where('id', content_id).first('id')) {
      return res.status(404).json({ status: 'error', message: 'Konten tidak ditemukan' });
    }

    const updated_at = new Date().toISOString();
    await db('notes')
      .insert({ user_id: req.user.id, content_id, page_number, note_text, updated_at })
      .onConflict(['user_id', 'content_id', 'page_number'])
      .merge({ note_text, updated_at });
    const note = await db('notes').where({ user_id: req.user.id, content_id, page_number }).first();
    res.status(201).json({ status: 'success', data: note });
  } catch (err) {
    console.error('[notes:upsert]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menyimpan catatan' });
  }
});

router.put('/notes/:id', auth, async (req, res) => {
  try {
    const id = validContentId(req.params.id);
    const note_text = typeof req.body.note_text === 'string' ? req.body.note_text.trim() : '';
    if (!id || !note_text) return res.status(400).json({ status: 'error', message: 'id dan note_text wajib valid' });
    const updated = await db('notes').where({ id, user_id: req.user.id }).update({ note_text, updated_at: new Date().toISOString() });
    if (!updated) return res.status(404).json({ status: 'error', message: 'Catatan tidak ditemukan' });
    res.json({ status: 'success', data: await db('notes').where({ id, user_id: req.user.id }).first() });
  } catch (err) {
    console.error('[notes:put]', err);
    res.status(500).json({ status: 'error', message: 'Gagal memperbarui catatan' });
  }
});

router.delete('/notes/:id', auth, async (req, res) => {
  try {
    const id = validContentId(req.params.id);
    if (!id) return res.status(400).json({ status: 'error', message: 'id tidak valid' });
    const deleted = await db('notes').where({ id, user_id: req.user.id }).del();
    if (!deleted) return res.status(404).json({ status: 'error', message: 'Catatan tidak ditemukan' });
    res.json({ status: 'success' });
  } catch (err) {
    console.error('[notes:delete]', err);
    res.status(500).json({ status: 'error', message: 'Gagal menghapus catatan' });
  }
});

router.get('/summary', auth, async (req, res) => {
  try {
    const [recent_reads, my_notes] = await Promise.all([
      db('reading_progress as progress')
        .join('contents as content', 'progress.content_id', 'content.id')
        .where('progress.user_id', req.user.id)
        .orderBy('progress.updated_at', 'desc')
        .select('content.id as content_id', 'content.title', 'content.author', 'content.description', 'content.level', 'progress.last_page as last_page_read', 'progress.updated_at'),
      db('notes as note')
        .join('contents as content', 'note.content_id', 'content.id')
        .where('note.user_id', req.user.id)
        .orderBy('note.updated_at', 'desc')
        .select('note.id', 'note.content_id', 'note.page_number', 'note.note_text', 'note.created_at', 'note.updated_at', 'content.title', 'content.author', 'content.level'),
    ]);
    res.json({ status: 'success', data: { recent_reads, my_notes } });
  } catch (err) {
    console.error('[activity:summary]', err);
    res.status(500).json({ status: 'error', message: 'Gagal mengambil ringkasan aktivitas' });
  }
});

module.exports = router;
