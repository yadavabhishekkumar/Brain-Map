const express = require('express');
const { pool } = require('../db');

const router = express.Router();

// Update a cross-link edge label
router.put('/:id', async (req, res, next) => {
  try {
    const { label } = req.body || {};
    if (label === undefined) return res.status(400).json({ error: 'label is required' });
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
    await pool.query('DELETE FROM edges WHERE id=$1', [req.params.id]);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;
