const express = require('express');
const { pool } = require('../db');
const { uuid } = require('../util');
const ai = require('../ai');

const router = express.Router();

// Feedback requires a signed-in user.
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
});

// List the current user's feedback, newest first.
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, content, status, completed, created_at FROM feedback WHERE owner_id = $1 ORDER BY created_at DESC',
      [req.user.sub]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Create a feedback entry.
router.post('/', async (req, res, next) => {
  try {
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Feedback is required' });
    const id = uuid();
    await pool.query('INSERT INTO feedback (id, owner_id, content) VALUES ($1,$2,$3)', [
      id,
      req.user.sub,
      content.slice(0, 5000),
    ]);
    const { rows } = await pool.query('SELECT id, content, status, completed, created_at FROM feedback WHERE id = $1', [id]);
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Rephrase a set of feedback entries into clean, actionable developer notes.
router.post('/rephrase', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const feedbacks = Array.isArray(req.body.feedbacks) ? req.body.feedbacks : [];
    if (!feedbacks.length) return res.status(400).json({ error: 'No feedback to rephrase' });

    const model = (req.body.model || 'deepseek').trim();
    const raw = feedbacks
      .map((f, i) => `${i + 1}. ${(f.content || '').trim()}`)
      .filter(Boolean)
      .join('\n\n');

    const messages = [
      {
        role: 'system',
        content:
          'You turn raw user feedback into clean, concise, well-organized development notes for an app developer. ' +
          'Rewrite the feedback as a clear numbered list of actionable requests. Remove filler and fix grammar, ' +
          'but preserve the original intent. Return only the polished text with no extra commentary.',
      },
      { role: 'user', content: `Here is the raw feedback:\n\n${raw}` },
    ];

    const { content } = await ai.chatCompletion(messages, {
      provider: model,
      maxTokens: 32000,
      temperature: 0.3,
      userId: req.user && req.user.sub,
    });

    res.json({ result: content });
  } catch (e) {
    next(e);
  }
});

// Update a feedback entry.
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const content = (req.body.content || '').trim();
    if (!content) return res.status(400).json({ error: 'Feedback is required' });
    const { rows } = await pool.query('SELECT id FROM feedback WHERE id = $1 AND owner_id = $2', [
      id,
      req.user.sub,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
    await pool.query('UPDATE feedback SET content = $1 WHERE id = $2', [content.slice(0, 5000), id]);
    const updated = await pool.query('SELECT id, content, status, completed, created_at FROM feedback WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (e) {
    next(e);
  }
});

// Delete a feedback entry.
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT id FROM feedback WHERE id = $1 AND owner_id = $2', [
      id,
      req.user.sub,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
    await pool.query('DELETE FROM feedback WHERE id = $1', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Set a feedback entry's approval status.
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = req.body.status === 'approved' ? 'approved' : 'unapproved';
    const { rows } = await pool.query('SELECT id FROM feedback WHERE id = $1 AND owner_id = $2', [
      id,
      req.user.sub,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
    await pool.query('UPDATE feedback SET status = $1 WHERE id = $2', [status, id]);
    const updated = await pool.query('SELECT id, content, status, completed, created_at FROM feedback WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (e) {
    next(e);
  }
});

// Set a feedback entry's completion status.
router.patch('/:id/completed', async (req, res, next) => {
  try {
    const { id } = req.params;
    const completed = req.body.completed === true;
    const { rows } = await pool.query('SELECT id FROM feedback WHERE id = $1 AND owner_id = $2', [
      id,
      req.user.sub,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Feedback not found' });
    await pool.query('UPDATE feedback SET completed = $1 WHERE id = $2', [completed, id]);
    const updated = await pool.query('SELECT id, content, status, completed, created_at FROM feedback WHERE id = $1', [id]);
    res.json(updated.rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
