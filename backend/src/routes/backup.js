const express = require('express');
const { pool } = require('../db');
const { uuid } = require('../util');
const storage = require('../storage');
const { indexNode } = require('../services/indexer');

const router = express.Router();

// Backup requires a signed-in user.
router.use((req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
});

// Export the current user's data as a single JSON object (attachments base64-encoded).
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const [userRow, canvases, categories, feedback] = await Promise.all([
      pool.query('SELECT name, email FROM users WHERE id = $1', [userId]),
      pool.query('SELECT id, name, description, is_public, category_id, created_at, updated_at FROM canvases WHERE owner_id = $1 ORDER BY created_at ASC', [userId]),
      pool.query('SELECT id, name, position, created_at FROM categories WHERE owner_id = $1 ORDER BY position ASC', [userId]),
      pool.query('SELECT id, content, status, completed, created_at FROM feedback WHERE owner_id = $1 ORDER BY created_at ASC', [userId]),
    ]);

    const canvasIds = canvases.rows.map((c) => c.id);
    let nodes = { rows: [] };
    let edges = { rows: [] };
    let attachments = { rows: [] };
    if (canvasIds.length) {
      nodes = await pool.query('SELECT * FROM nodes WHERE canvas_id = ANY($1::uuid[]) ORDER BY depth ASC, y ASC', [canvasIds]);
      edges = await pool.query('SELECT * FROM edges WHERE canvas_id = ANY($1::uuid[])', [canvasIds]);
      attachments = await pool.query('SELECT * FROM attachments WHERE canvas_id = ANY($1::uuid[])', [canvasIds]);
    }

    const attachmentsOut = [];
    for (const a of attachments.rows) {
      let dataBase64 = null;
      try {
        const buf = await storage.getBuffer(a.storage_key);
        dataBase64 = buf.toString('base64');
      } catch (e) {
        // File missing from storage — keep the metadata only.
      }
      attachmentsOut.push({
        id: a.id,
        node_id: a.node_id,
        canvas_id: a.canvas_id,
        original_filename: a.original_filename,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        extracted_text: a.extracted_text,
        status: a.status,
        applied_action: a.applied_action,
        created_at: a.created_at,
        data_base64: dataBase64,
      });
    }

    res.json({
      app: 'upsc-brainmap',
      format: 1,
      exported_at: new Date().toISOString(),
      user: userRow.rows[0] ? { name: userRow.rows[0].name, email: userRow.rows[0].email } : null,
      categories: categories.rows,
      canvases: canvases.rows,
      nodes: nodes.rows,
      edges: edges.rows,
      feedback: feedback.rows,
      attachments: attachmentsOut,
    });
  } catch (e) {
    next(e);
  }
});

// Restore a backup: adds everything under the current user with fresh IDs.
router.post('/restore', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (b.app !== 'upsc-brainmap' || b.format !== 1) {
      return res.status(400).json({ error: 'Unsupported backup format' });
    }

    const catMap = new Map();
    const canvasMap = new Map();
    const nodeMap = new Map();

    let catCount = 0;
    for (const c of b.categories || []) {
      const nid = uuid();
      catMap.set(c.id, nid);
      await pool.query('INSERT INTO categories (id, owner_id, name, position) VALUES ($1,$2,$3,$4)', [nid, req.user.sub, (c.name || 'Untitled').slice(0, 80), c.position || 0]);
      catCount += 1;
    }

    let canvasCount = 0;
    for (const c of b.canvases || []) {
      const nid = uuid();
      canvasMap.set(c.id, nid);
      const catId = c.category_id && catMap.has(c.category_id) ? catMap.get(c.category_id) : null;
      await pool.query('INSERT INTO canvases (id, name, description, owner_id, category_id, is_public) VALUES ($1,$2,$3,$4,$5,$6)', [nid, c.name || 'Untitled', c.description || '', req.user.sub, catId, !!c.is_public]);
      canvasCount += 1;
    }

    let nodeCount = 0;
    const nodes = (b.nodes || []).slice().sort((x, y) => (x.depth || 0) - (y.depth || 0));
    for (const n of nodes) {
      const canvasId = canvasMap.get(n.canvas_id);
      if (!canvasId) continue;
      const nid = uuid();
      nodeMap.set(n.id, nid);
      const parentId = n.parent_id && nodeMap.has(n.parent_id) ? nodeMap.get(n.parent_id) : null;
      const linkedId = n.linked_canvas_id && canvasMap.has(n.linked_canvas_id) ? canvasMap.get(n.linked_canvas_id) : null;
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth, metadata, linked_canvas_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [nid, canvasId, parentId, n.label || '', n.content || '', n.x || 0, n.y || 0, n.depth || 0, n.metadata || {}, linkedId]
      );
      nodeCount += 1;
      try { await indexNode(nid); } catch (e) { /* Elasticsearch is optional */ }
    }

    let edgeCount = 0;
    for (const e of b.edges || []) {
      const canvasId = canvasMap.get(e.canvas_id);
      const s = nodeMap.get(e.source_id);
      const t = nodeMap.get(e.target_id);
      if (!canvasId || !s || !t) continue;
      await pool.query('INSERT INTO edges (id, canvas_id, source_id, target_id, label) VALUES ($1,$2,$3,$4,$5)', [uuid(), canvasId, s, t, e.label || '']);
      edgeCount += 1;
    }

    let fbCount = 0;
    for (const f of b.feedback || []) {
      await pool.query('INSERT INTO feedback (id, owner_id, content, status, completed) VALUES ($1,$2,$3,$4,$5)', [uuid(), req.user.sub, f.content || '', f.status || 'unapproved', !!f.completed]);
      fbCount += 1;
    }

    let attCount = 0;
    for (const a of b.attachments || []) {
      const nodeId = nodeMap.get(a.node_id);
      const canvasId = canvasMap.get(a.canvas_id);
      if (!nodeId || !canvasId) continue;
      const aid = uuid();
      const ext = ((a.original_filename || '').split('.').pop() || 'png').toLowerCase().slice(0, 8);
      const key = `${canvasId}/${nodeId}/${aid}.${ext}`;
      let wroteFile = false;
      if (a.data_base64) {
        try {
          await storage.put(key, Buffer.from(a.data_base64, 'base64'), a.mime_type || 'application/octet-stream');
          wroteFile = true;
        } catch (e) {
          wroteFile = false;
        }
      }
      await pool.query(
        `INSERT INTO attachments (id, node_id, canvas_id, storage_key, original_filename, mime_type, size_bytes, extracted_text, status, applied_action)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [aid, nodeId, canvasId, wroteFile ? key : '', a.original_filename || '', a.mime_type || '', a.size_bytes || 0, a.extracted_text || '', a.status || 'uploaded', a.applied_action || null]
      );
      attCount += 1;
    }

    res.json({
      restored: {
        categories: catCount,
        canvases: canvasCount,
        nodes: nodeCount,
        edges: edgeCount,
        feedback: fbCount,
        attachments: attCount,
      },
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
