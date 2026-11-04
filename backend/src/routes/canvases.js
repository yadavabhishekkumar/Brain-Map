const express = require('express');
const { pool } = require('../db');
const { uuid } = require('../util');
const { indexNode } = require('../services/indexer');
const es = require('../es');
const storage = require('../storage');

const router = express.Router();

// List all canvases
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.description, c.created_at, c.updated_at,
              (SELECT count(*)::int FROM nodes n WHERE n.canvas_id = c.id) AS node_count,
              (SELECT count(*)::int FROM attachments a WHERE a.canvas_id = c.id) AS attachment_count,
              (SELECT n.canvas_id FROM nodes n WHERE n.linked_canvas_id = c.id LIMIT 1) AS linked_from_canvas_id
       FROM canvases c
       ORDER BY c.updated_at DESC`
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Create a blank canvas (also creates its root node)
router.post('/', async (req, res, next) => {
  try {
    const name = (req.body.name || 'Untitled canvas').trim() || 'Untitled canvas';
    const description = (req.body.description || '').trim();
    const id = uuid();
    await pool.query('INSERT INTO canvases (id, name, description) VALUES ($1,$2,$3)', [
      id,
      name,
      description,
    ]);

    const rootId = uuid();
    await pool.query(
      `INSERT INTO nodes (id, canvas_id, label, content, x, y, depth) VALUES ($1,$2,$3,'',0,0,0)`,
      [rootId, id, name]
    );
    await indexNode(rootId);

    const { rows } = await pool.query('SELECT * FROM canvases WHERE id=$1', [id]);
    res.status(201).json({ ...rows[0], root_node_id: rootId });
  } catch (e) {
    next(e);
  }
});

// Get a canvas with its full tree (nodes + cross-link edges)
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const canvas = await pool.query('SELECT * FROM canvases WHERE id=$1', [id]);
    if (!canvas.rows[0]) return res.status(404).json({ error: 'Canvas not found' });

    const nodes = await pool.query(
      `SELECT n.id, n.canvas_id, n.parent_id, n.label, n.content, n.x, n.y, n.depth,
              n.linked_canvas_id, c2.name AS linked_canvas_name,
              (SELECT count(*)::int FROM attachments a WHERE a.node_id = n.id) AS attachment_count
       FROM nodes n
       LEFT JOIN canvases c2 ON c2.id = n.linked_canvas_id
       WHERE n.canvas_id = $1`,
      [id]
    );

    const edges = await pool.query(
      `SELECT id, canvas_id, source_id, target_id, label FROM edges WHERE canvas_id=$1`,
      [id]
    );

    res.json({ canvas: canvas.rows[0], nodes: nodes.rows, edges: edges.rows });
  } catch (e) {
    next(e);
  }
});

// Rename / update canvas
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const fields = [];
    const values = [];
    let i = 1;
    if (req.body.name !== undefined) {
      fields.push(`name=$${i++}`);
      values.push(req.body.name);
    }
    if (req.body.description !== undefined) {
      fields.push(`description=$${i++}`);
      values.push(req.body.description);
    }
    if (fields.length) {
      fields.push('updated_at=now()');
      values.push(id);
      await pool.query(`UPDATE canvases SET ${fields.join(', ')} WHERE id=$${i}`, values);
    }
    const { rows } = await pool.query('SELECT * FROM canvases WHERE id=$1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Canvas not found' });
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Delete a canvas (cascade deletes nodes/edges/attachments rows)
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const att = await pool.query(
      `SELECT a.storage_key
       FROM attachments a
       JOIN nodes n ON a.node_id = n.id
       WHERE n.canvas_id = $1`,
      [id]
    );
    const nodes = await pool.query('SELECT id FROM nodes WHERE canvas_id = $1', [id]);
    await pool.query('DELETE FROM canvases WHERE id=$1', [id]);
    for (const a of att.rows) {
      try {
        await storage.remove(a.storage_key);
      } catch (e) {
        // ignore cleanup errors
      }
    }
    for (const n of nodes.rows) {
      await es.removeNode(n.id);
    }
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// Create a node inside a canvas
router.post('/:id/nodes', async (req, res, next) => {
  try {
    const canvasId = req.params.id;
    const { label, content, parent_id, x, y } = req.body || {};

    let depth = 0;
    if (parent_id) {
      const p = await pool.query('SELECT depth FROM nodes WHERE id=$1 AND canvas_id=$2', [
        parent_id,
        canvasId,
      ]);
      if (!p.rows[0]) return res.status(404).json({ error: 'Parent node not found' });
      depth = p.rows[0].depth + 1;
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        id,
        canvasId,
        parent_id || null,
        (label || 'New topic').trim() || 'New topic',
        (content || '').trim(),
        x || 0,
        y || 0,
        depth,
      ]
    );
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [canvasId]);
    await indexNode(id);

    const { rows } = await pool.query('SELECT * FROM nodes WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Create a logical (cross-link) connection between two nodes
router.post('/:id/edges', async (req, res, next) => {
  try {
    const canvasId = req.params.id;
    const { source_id, target_id, label } = req.body || {};
    if (!source_id || !target_id) {
      return res.status(400).json({ error: 'source_id and target_id are required' });
    }
    const id = uuid();
    await pool.query(
      `INSERT INTO edges (id, canvas_id, source_id, target_id, label) VALUES ($1,$2,$3,$4,$5)`,
      [id, canvasId, source_id, target_id, (label || '').trim()]
    );
    const { rows } = await pool.query('SELECT * FROM edges WHERE id=$1', [id]);
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Link an existing canvas into this canvas as a topic node
router.post('/:id/link', async (req, res, next) => {
  try {
    const canvasId = req.params.id;
    const { target_canvas_id, parent_id, x, y } = req.body || {};
    if (!target_canvas_id) return res.status(400).json({ error: 'target_canvas_id is required' });
    if (target_canvas_id === canvasId) {
      return res.status(400).json({ error: 'Cannot link a canvas to itself' });
    }

    const target = await pool.query('SELECT id, name FROM canvases WHERE id=$1', [target_canvas_id]);
    if (!target.rows[0]) return res.status(404).json({ error: 'Target canvas not found' });

    let depth = 0;
    if (parent_id) {
      const p = await pool.query('SELECT depth FROM nodes WHERE id=$1 AND canvas_id=$2', [
        parent_id,
        canvasId,
      ]);
      if (!p.rows[0]) return res.status(404).json({ error: 'Parent node not found' });
      depth = p.rows[0].depth + 1;
    }

    const id = uuid();
    await pool.query(
      `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth, linked_canvas_id)
       VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8)`,
      [id, canvasId, parent_id || null, target.rows[0].name, x || 0, y || 0, depth, target_canvas_id]
    );
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [canvasId]);
    await indexNode(id);

    const { rows } = await pool.query(
      `SELECT n.*, c.name AS linked_canvas_name
       FROM nodes n LEFT JOIN canvases c ON c.id = n.linked_canvas_id
       WHERE n.id = $1`,
      [id]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
