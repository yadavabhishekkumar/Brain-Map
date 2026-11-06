const express = require('express');
const { pool } = require('../db');
const { uuid } = require('../util');
const { indexNode } = require('../services/indexer');
const es = require('../es');
const storage = require('../storage');
const { requireCanvasOwner } = require('../services/access');

const router = express.Router();

// List canvases: public maps + (when logged in) the user's private maps.
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user ? req.user.sub : null;
    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.description, c.owner_id, u.name AS owner_name,
              (c.owner_id IS NULL) AS is_public,
              c.created_at, c.updated_at,
              (SELECT count(*)::int FROM nodes n WHERE n.canvas_id = c.id) AS node_count,
              (SELECT count(*)::int FROM attachments a WHERE a.canvas_id = c.id) AS attachment_count,
              (SELECT n.canvas_id FROM nodes n WHERE n.linked_canvas_id = c.id LIMIT 1) AS linked_from_canvas_id
       FROM canvases c
       LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.owner_id IS NULL OR c.owner_id = $1
       ORDER BY c.updated_at DESC`,
      [userId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Create a blank canvas (also creates its root node). Requires an account.
router.post('/', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required to create a canvas' });
    const name = (req.body.name || 'Untitled canvas').trim() || 'Untitled canvas';
    const description = (req.body.description || '').trim();
    const id = uuid();
    await pool.query('INSERT INTO canvases (id, name, description, owner_id) VALUES ($1,$2,$3,$4)', [
      id,
      name,
      description,
      req.user.sub,
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
    if (canvas.rows[0].owner_id && (!req.user || req.user.sub !== canvas.rows[0].owner_id)) {
      return res.status(403).json({ error: 'You do not have access to this canvas' });
    }

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

    // Canvases that contain a node linking to this canvas (i.e. "parent" canvases
    // this canvas is embedded in). Used for the "back to parent" navigation.
    const parentCanvases = await pool.query(
      `SELECT DISTINCT c.id, c.name
       FROM canvases c
       JOIN nodes n ON n.canvas_id = c.id
       WHERE n.linked_canvas_id = $1
       ORDER BY c.name`,
      [id]
    );

    res.json({
      canvas: canvas.rows[0],
      parentCanvases: parentCanvases.rows,
      nodes: nodes.rows,
      edges: edges.rows,
    });
  } catch (e) {
    next(e);
  }
});

// Rename / update canvas
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const err = await requireCanvasOwner(req.user, id);
    if (err) return res.status(err.status).json({ error: err.error });
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
    const err = await requireCanvasOwner(req.user, id);
    if (err) return res.status(err.status).json({ error: err.error });
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
    const err = await requireCanvasOwner(req.user, canvasId);
    if (err) return res.status(err.status).json({ error: err.error });
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
    const err = await requireCanvasOwner(req.user, canvasId);
    if (err) return res.status(err.status).json({ error: err.error });
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
    const err = await requireCanvasOwner(req.user, canvasId);
    if (err) return res.status(err.status).json({ error: err.error });
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

// List chat history for a canvas (the top-level "Ask AI" panel).
router.get('/:id/chats', async (req, res, next) => {
  try {
    const err = await requireCanvasOwner(req.user, req.params.id);
    if (err) return res.status(err.status).json({ error: err.error });
    const { rows } = await pool.query(
      `SELECT id, canvas_id, question, answer, author, created_at
       FROM canvas_chats WHERE canvas_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Fork a public canvas into the current user's account (deep copy).
router.post('/:id/fork', async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Authentication required to fork a canvas' });
    const { id } = req.params;
    const src = await pool.query('SELECT * FROM canvases WHERE id=$1', [id]);
    if (!src.rows[0]) return res.status(404).json({ error: 'Canvas not found' });
    const srcCanvas = src.rows[0];
    if (srcCanvas.owner_id && srcCanvas.owner_id !== req.user.sub) {
      return res.status(403).json({ error: 'You can only fork public canvases' });
    }

    const newId = uuid();
    await pool.query('INSERT INTO canvases (id, name, description, owner_id) VALUES ($1,$2,$3,$4)', [
      newId,
      `${srcCanvas.name} (fork)`,
      srcCanvas.description || '',
      req.user.sub,
    ]);

    // Copy nodes (ordered so parents exist before their children).
    const nodes = await pool.query('SELECT * FROM nodes WHERE canvas_id=$1 ORDER BY depth ASC, y ASC', [id]);
    const idMap = new Map();
    for (const n of nodes.rows) {
      const newNodeId = uuid();
      idMap.set(n.id, newNodeId);
      const newParentId = n.parent_id && idMap.has(n.parent_id) ? idMap.get(n.parent_id) : null;
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth, metadata, linked_canvas_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [newNodeId, newId, newParentId, n.label, n.content || '', n.x, n.y, n.depth, n.metadata || {}, n.linked_canvas_id || null]
      );
      await indexNode(newNodeId);
    }

    // Copy cross-link edges.
    const edges = await pool.query('SELECT * FROM edges WHERE canvas_id=$1', [id]);
    for (const e of edges.rows) {
      const s = idMap.get(e.source_id);
      const t = idMap.get(e.target_id);
      if (s && t) {
        await pool.query(
          'INSERT INTO edges (id, canvas_id, source_id, target_id, label) VALUES ($1,$2,$3,$4,$5)',
          [uuid(), newId, s, t, e.label || '']
        );
      }
    }

    res.status(201).json({ canvas_id: newId, name: `${srcCanvas.name} (fork)` });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
