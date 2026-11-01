const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { uuid } = require('../util');
const { indexNode } = require('../services/indexer');
const es = require('../es');
const storage = require('../storage');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

// Recompute depth for every node of a canvas (recursive CTE from roots)
async function recomputeDepths(canvasId) {
  await pool.query(
    `WITH RECURSIVE tree AS (
       SELECT id, 0 AS d FROM nodes WHERE canvas_id = $1 AND parent_id IS NULL
       UNION ALL
       SELECT n.id, tree.d + 1 FROM nodes n JOIN tree ON n.parent_id = tree.id
     )
     UPDATE nodes SET depth = tree.d, updated_at = now()
     FROM tree WHERE nodes.id = tree.id AND nodes.canvas_id = $1`,
    [canvasId]
  );
}

// Get a single node with its attachments
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const node = await pool.query(
      `SELECT n.*, c.name AS linked_canvas_name,
              (SELECT count(*)::int FROM attachments a WHERE a.node_id = n.id) AS attachment_count
       FROM nodes n
       LEFT JOIN canvases c ON c.id = n.linked_canvas_id
       WHERE n.id = $1`,
      [id]
    );
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });

    const att = await pool.query(
      `SELECT id, node_id, original_filename, mime_type, size_bytes, extracted_text, status, applied_action, created_at
       FROM attachments WHERE node_id = $1 ORDER BY created_at ASC`,
      [id]
    );
    res.json({ ...node.rows[0], attachments: att.rows });
  } catch (e) {
    next(e);
  }
});

// Update a node (label, content, position, or parent)
router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const node = await pool.query('SELECT * FROM nodes WHERE id=$1', [id]);
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });
    const canvasId = node.rows[0].canvas_id;

    const fields = [];
    const values = [];
    let i = 1;
    for (const col of ['label', 'content', 'x', 'y', 'parent_id']) {
      if (req.body[col] !== undefined) {
        fields.push(`${col}=$${i++}`);
        values.push(req.body[col]);
      }
    }
    if (fields.length) {
      fields.push('updated_at=now()');
      values.push(id);
      await pool.query(`UPDATE nodes SET ${fields.join(', ')} WHERE id=$${i}`, values);
      await recomputeDepths(canvasId);
    }
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [canvasId]);

    const { rows } = await pool.query('SELECT * FROM nodes WHERE id=$1', [id]);
    await indexNode(id);
    res.json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// Delete a node and its subtree
router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const node = await pool.query('SELECT canvas_id FROM nodes WHERE id=$1', [id]);
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });

    // Collect attachment storage keys for the whole subtree before cascade delete
    const att = await pool.query(
      `SELECT a.storage_key FROM attachments a
       WHERE a.node_id IN (
         WITH RECURSIVE sub AS (
           SELECT id FROM nodes WHERE id = $1
           UNION ALL
           SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
         ) SELECT id FROM sub
       )`,
      [id]
    );

    // Collect node ids for Elasticsearch cleanup
    const ids = await pool.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM nodes WHERE id = $1
         UNION ALL
         SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
       ) SELECT id FROM sub`,
      [id]
    );

    await pool.query('DELETE FROM nodes WHERE id=$1', [id]);

    for (const a of att.rows) {
      try {
        await storage.remove(a.storage_key);
      } catch (e) {
        // ignore cleanup errors
      }
    }
    for (const row of ids.rows) {
      await es.removeNode(row.id);
    }
    await recomputeDepths(node.rows[0].canvas_id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

// List attachments for a node
router.get('/:id/attachments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, node_id, original_filename, mime_type, size_bytes, extracted_text, status, applied_action, created_at
       FROM attachments WHERE node_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// Upload a screenshot/note image to a node
router.post('/:id/attachments', upload.single('file'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const node = await pool.query('SELECT * FROM nodes WHERE id=$1', [id]);
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const canvasId = node.rows[0].canvas_id;
    const aid = uuid();
    const ext = (req.file.originalname.split('.').pop() || 'png').toLowerCase().slice(0, 8);
    const key = `${canvasId}/${id}/${aid}.${ext}`;
    await storage.put(key, req.file.buffer, req.file.mimetype);

    await pool.query(
      `INSERT INTO attachments (id, node_id, canvas_id, storage_key, original_filename, mime_type, size_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [aid, id, canvasId, key, req.file.originalname, req.file.mimetype, req.file.size]
    );
    await indexNode(id);

    const { rows } = await pool.query(
      `SELECT id, node_id, original_filename, mime_type, size_bytes, extracted_text, status, applied_action, created_at
       FROM attachments WHERE id = $1`,
      [aid]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    next(e);
  }
});

// List AI chat history for a node
router.get('/:id/chats', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, node_id, question, answer, author, created_at
       FROM node_chats WHERE node_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
