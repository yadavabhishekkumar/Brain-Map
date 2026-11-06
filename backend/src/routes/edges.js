const express = require('express');
const { pool } = require('../db');
const { requireCanvasOwner } = require('../services/access');

const router = express.Router();

// Update a cross-link edge label
router.put('/:id', async (req, res, next) => {
  try {
    const { label } = req.body || {};
    if (label === undefined) return res.status(400).json({ error: 'label is required' });
    const edge = await pool.query('SELECT canvas_id FROM edges WHERE id=$1', [req.params.id]);
    if (!edge.rows[0]) return res.status(404).json({ error: 'Edge not found' });
    const err = await requireCanvasOwner(req.user, edge.rows[0].canvas_id);
    if (err) return res.status(err.status).json({ error: err.error });
    await pool.query('UPDATE edges SET label=$1 WHERE id=$2', [label, req.params.id]);
    const { rows } = await pool.query('SELECT * FROM edges WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Edge not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Delete a cross-link edge
router.delete('/:id', async (req, res, next) => {
  try {
    const edge = await pool.query('SELECT canvas_id FROM edges WHERE id=$1', [req.params.id]);
    if (!edge.rows[0]) return res.status(404).json({ error: 'Edge not found' });
    const err = await requireCanvasOwner(req.user, edge.rows[0].canvas_id);
    if (err) return res.status(err.status).json({ error: err.error });
    await pool.query('DELETE FROM edges WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;
