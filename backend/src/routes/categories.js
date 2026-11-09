const express = require('express');
const { pool } = require('../db');
const { uuid } = require('../util');

const router = express.Router();

// All category routes require a signed-in user.
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
});

// List the current user's categories (ordered by position).
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, position, created_at,
              (SELECT count(*)::int FROM canvases c WHERE c.category_id = categories.id) AS canvas_count
       FROM categories
       WHERE owner_id = $1
       ORDER BY position ASC, created_at ASC`,
      [req.user.sub]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Create a category.
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const id = uuid();
    const pos = await pool.query(
      'SELECT COALESCE(MAX(position), 0) + 1 AS next FROM categories WHERE owner_id = $1',
      [req.user.sub]
    );
    await pool.query(
      'INSERT INTO categories (id, owner_id, name, position) VALUES ($1,$2,$3,$4)',
      [id, req.user.sub, name.slice(0, 80), pos.rows[0].next]
    );
    const { rows } = await pool.query(
      'SELECT id, name, position, created_at FROM categories WHERE id = $1',
      [id]
    );
    res.status(201).json({ ...rows[0], canvas_count: 0 });
  } catch (e) {
    next(e);
  }
});

// Rename a category.
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Name is required' });
    const { rows } = await pool.query(
      'SELECT * FROM categories WHERE id = $1 AND owner_id = $2',
      [id, req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Category not found' });
    await pool.query('UPDATE categories SET name = $1 WHERE id = $2', [name.slice(0, 80), id]);
    res.json({ id, name: name.slice(0, 80), position: rows[0].position });
  } catch (e) {
    next(e);
  }
});

// Delete a category. Its canvases become uncategorized (they are NOT deleted).
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(
      'SELECT * FROM categories WHERE id = $1 AND owner_id = $2',
      [id, req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Category not found' });
    await pool.query('UPDATE canvases SET category_id = NULL WHERE category_id = $1', [id]);
    await pool.query('DELETE FROM categories WHERE id = $1', [id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;
