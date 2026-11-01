const express = require('express');
const { pool } = require('../db');
const es = require('../es');

const router = express.Router();

// Full-text search across a canvas (or globally). Uses Elasticsearch,
// with a Postgres ILIKE fallback if Elasticsearch is unavailable.
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q || '').trim();
    const canvasId = req.query.canvas_id || null;
    if (!q) return res.json({ hits: [], total: 0 });

    try {
      const result = await es.search(q, canvasId);
      return res.json(result);
    } catch (e) {
      console.warn('[search] Elasticsearch unavailable, using Postgres fallback:', e.message);
      const like = `%${q}%`;
      const params = [like];
      let where = `(n.label ILIKE $1 OR n.content ILIKE $1 OR EXISTS (
        SELECT 1 FROM attachments a WHERE a.node_id = n.id AND a.extracted_text ILIKE $1
      ))`;
      if (canvasId) {
        params.push(canvasId);
        where += ` AND n.canvas_id = $2`;
      }
      const { rows } = await pool.query(
        `SELECT n.id, n.canvas_id, n.label, n.content, n.depth
         FROM nodes n WHERE ${where} LIMIT 50`,
        params
      );
      return res.json({ hits: rows, total: rows.length, fallback: true });
    }
  } catch (e) {
    next(e);
  }
});

module.exports = router;
