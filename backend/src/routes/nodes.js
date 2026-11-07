const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { uuid } = require('../util');
const { indexNode } = require('../services/indexer');
const es = require('../es');
const storage = require('../storage');
const { recomputeDepths, relayoutCanvas } = require('../services/layout');
const { requireCanvasOwner, requireCanvasRead, nodeCanvasId } = require('../services/access');
const { uniqueCanvasName } = require('../services/names');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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
    const readErr = await requireCanvasRead(req.user, node.rows[0].canvas_id);
    if (readErr) return res.status(readErr.status).json({ error: readErr.error });

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
    const err = await requireCanvasOwner(req.user, canvasId);
    if (err) return res.status(err.status).json({ error: err.error });

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
    const err = await requireCanvasOwner(req.user, node.rows[0].canvas_id);
    if (err) return res.status(err.status).json({ error: err.error });

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

// Merge a node into its parent: optionally append the node's title/description
// to the parent, then reparent the node's children and delete it.
router.post('/:id/merge-into-parent', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { mode } = req.body || {}; // 'drop' | 'append'
    const node = await pool.query('SELECT id, canvas_id, parent_id, label, content FROM nodes WHERE id=$1', [id]);
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });
    const { canvas_id, parent_id, label, content } = node.rows[0];
    if (!parent_id) return res.status(400).json({ error: 'Cannot merge a root node' });
    const err = await requireCanvasOwner(req.user, canvas_id);
    if (err) return res.status(err.status).json({ error: err.error });

    if (mode === 'append') {
      const parent = await pool.query('SELECT label, content FROM nodes WHERE id=$1', [parent_id]);
      if (parent.rows[0]) {
        const p = parent.rows[0];
        const pTitle = (p.label || '').trim();
        const cTitle = (label || '').trim();
        const newTitle = pTitle && cTitle ? `${pTitle} & ${cTitle}` : pTitle || cTitle;
        const newContent = [p.content, content].filter((s) => s && String(s).trim()).join('\n\n');
        await pool.query('UPDATE nodes SET label=$1, content=$2, updated_at=now() WHERE id=$3', [newTitle, newContent, parent_id]);
        await indexNode(parent_id);
      }
    }

    // Reparent this node's children to its parent.
    await pool.query('UPDATE nodes SET parent_id=$1, updated_at=now() WHERE parent_id=$2', [parent_id, id]);

    // Remove this node's own attachment files (rows are removed by cascade).
    const att = await pool.query('SELECT storage_key FROM attachments WHERE node_id=$1', [id]);
    await pool.query('DELETE FROM nodes WHERE id=$1', [id]);
    await es.removeNode(id);
    for (const a of att.rows) {
      try {
        await storage.remove(a.storage_key);
      } catch (e) {
        // ignore cleanup errors
      }
    }

    await recomputeDepths(canvas_id);
    await relayoutCanvas(canvas_id);
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [canvas_id]);

    res.json({ merged: true, mode: mode || 'drop' });
  } catch (e) {
    next(e);
  }
});

// List attachments for a node
router.get('/:id/attachments', async (req, res, next) => {
  try {
    const canvasId = await nodeCanvasId(req.params.id);
    if (!canvasId) return res.status(404).json({ error: 'Node not found' });
    const readErr = await requireCanvasRead(req.user, canvasId);
    if (readErr) return res.status(readErr.status).json({ error: readErr.error });
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
    const err = await requireCanvasOwner(req.user, canvasId);
    if (err) return res.status(err.status).json({ error: err.error });
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
    const canvasId = await nodeCanvasId(req.params.id);
    if (!canvasId) return res.status(404).json({ error: 'Node not found' });
    const err = await requireCanvasOwner(req.user, canvasId);
    if (err) return res.status(err.status).json({ error: err.error });
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

// Export a node and its entire subtree to a new, linked canvas.
router.post('/:id/export', async (req, res, next) => {
  try {
    const { id } = req.params;
    const node = await pool.query('SELECT * FROM nodes WHERE id=$1', [id]);
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });
    const self = node.rows[0];
    const err = await requireCanvasOwner(req.user, self.canvas_id);
    if (err) return res.status(err.status).json({ error: err.error });

    // 1) Collect the subtree (self + descendants) ordered by depth.
    const subtree = await pool.query(
      `WITH RECURSIVE sub AS (
         SELECT id, canvas_id, parent_id, label, content, x, y, depth, metadata, linked_canvas_id
         FROM nodes WHERE id = $1
         UNION ALL
         SELECT n.id, n.canvas_id, n.parent_id, n.label, n.content, n.x, n.y, n.depth, n.metadata, n.linked_canvas_id
         FROM nodes n JOIN sub s ON n.parent_id = s.id
       )
       SELECT * FROM sub ORDER BY depth ASC`,
      [id]
    );
    const rows = subtree.rows;
    if (!rows.length) return res.status(404).json({ error: 'Node not found' });

    const canvasName = await uniqueCanvasName(
      (self.label || 'Exported topic').trim().slice(0, 100) || 'Exported topic',
      req.user.sub
    );
    const description = (self.content || '').trim().slice(0, 240);

    // 2) Create the new canvas.
    const newCanvasId = uuid();
    await pool.query('INSERT INTO canvases (id, name, description, owner_id) VALUES ($1,$2,$3,$4)', [
      newCanvasId,
      canvasName,
      description,
      req.user.sub,
    ]);

    // 3) Copy the subtree into the new canvas (self becomes the root).
    const idMap = new Map(); // old node id -> new node id
    for (const r of rows) {
      const newId = uuid();
      idMap.set(r.id, newId);
      const newParentId = r.parent_id && idMap.has(r.parent_id) ? idMap.get(r.parent_id) : null;
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth, metadata, linked_canvas_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          newId,
          newCanvasId,
          newParentId,
          r.label,
          r.content || '',
          r.x - self.x,
          r.y - self.y,
          r.depth - self.depth,
          r.metadata || {},
          r.id === self.id ? null : r.linked_canvas_id || null,
        ]
      );
    }

    // 4) Move attachments for the whole subtree to the new canvas.
    const subtreeIds = rows.map((r) => r.id);
    const atts = await pool.query('SELECT * FROM attachments WHERE node_id = ANY($1::uuid[])', [subtreeIds]);
    for (const a of atts.rows) {
      const newNodeId = idMap.get(a.node_id);
      if (!newNodeId) continue;
      const ext = (a.storage_key.split('.').pop() || 'png').slice(0, 8);
      const newKey = `${newCanvasId}/${newNodeId}/${a.id}.${ext}`;
      try {
        const buf = await storage.getBuffer(a.storage_key);
        await storage.put(newKey, buf, a.mime_type);
        await pool.query(
          'UPDATE attachments SET node_id=$1, canvas_id=$2, storage_key=$3 WHERE id=$4',
          [newNodeId, newCanvasId, newKey, a.id]
        );
        await storage.remove(a.storage_key);
      } catch (err) {
        console.warn('[export] failed to move attachment', a.id, err.message);
      }
    }

    // 5) In the current canvas: turn the selected node into a link to the new
    //    canvas and delete the moved descendants.
    await pool.query('UPDATE nodes SET linked_canvas_id=$1, updated_at=now() WHERE id=$2', [newCanvasId, id]);
    const descendantIds = subtreeIds.filter((x) => x !== id);
    if (descendantIds.length) {
      await pool.query('DELETE FROM nodes WHERE id = ANY($1::uuid[])', [descendantIds]);
      for (const did of descendantIds) await es.removeNode(did);
    }
    await recomputeDepths(self.canvas_id);
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [self.canvas_id]);

    // 6) Reindex the linked node and the new canvas nodes.
    await indexNode(id);
    for (const oldId of subtreeIds) {
      const newId = idMap.get(oldId);
      if (newId) await indexNode(newId);
    }

    res.json({
      canvas_id: newCanvasId,
      canvas_name: canvasName,
      linked_node_id: id,
      moved_count: rows.length,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
