const express = require('express');
const { pool } = require('../db');
const storage = require('../storage');
const ai = require('../ai');
const { uuid, parseExtractedText } = require('../util');
const { indexNode } = require('../services/indexer');

const router = express.Router();

// Stream the binary file for an attachment
router.get('/:id/file', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found' });
    const { stream, contentType } = await storage.getStream(rows[0].storage_key);
    res.setHeader('Content-Type', contentType || rows[0].mime_type);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(rows[0].original_filename)}"`
    );
    stream.on('error', (e) => {
      console.error('[storage] stream error:', e);
      res.destroy();
    });
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
});

// Extract text from an attachment image using AI vision or OCR
router.post('/:id/extract', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found' });
    const att = rows[0];

    await pool.query(`UPDATE attachments SET status='extracting' WHERE id=$1`, [att.id]);
    try {
      const buffer = await storage.getBuffer(att.storage_key);
      const mode = (req.body && req.body.mode) || 'auto';
      const text = await ai.extractText(buffer, att.mime_type, mode);

      await pool.query(
        `UPDATE attachments SET extracted_text=$1, status='extracted', applied_action=NULL WHERE id=$2`,
        [text, att.id]
      );
      await indexNode(att.node_id);

      res.json({ id: att.id, extracted_text: text, status: 'extracted' });
    } catch (err) {
      await pool.query(`UPDATE attachments SET status='uploaded' WHERE id=$1`, [att.id]);
      throw err;
    }
  } catch (e) {
    next(e);
  }
});

// Apply extracted text: 'store' (leave as text), 'append_text', or 'append_nodes'
router.post('/:id/apply', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found' });
    const att = rows[0];

    const action = (req.body && req.body.action) || 'store';
    const text =
      req.body && req.body.text !== undefined ? req.body.text : att.extracted_text;

    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'No extracted text to apply' });
    }

    if (action === 'append_text') {
      const node = await pool.query('SELECT content FROM nodes WHERE id=$1', [att.node_id]);
      const existing = node.rows[0].content || '';
      await pool.query(
        'UPDATE nodes SET content=$1, updated_at=now() WHERE id=$2',
        [existing + (existing ? '\n\n' : '') + text.trim(), att.node_id]
      );
      await pool.query(
        `UPDATE attachments SET status='applied', applied_action='append_text', extracted_text=$1 WHERE id=$2`,
        [text.trim(), att.id]
      );
      await indexNode(att.node_id);
      return res.json({ action: 'append_text', applied: true });
    }

    if (action === 'append_nodes') {
      const node = await pool.query('SELECT * FROM nodes WHERE id=$1', [att.node_id]);
      const rootNode = node.rows[0];
      const parsed = parseExtractedText(text);
      if (!parsed.length) {
        return res.status(400).json({ error: 'No parseable content found' });
      }

      const levelParent = {};
      const created = [];
      for (const item of parsed) {
        let parentId = rootNode.id;
        if (item.level > 0) {
          for (let l = item.level - 1; l >= 0; l--) {
            if (levelParent[l]) {
              parentId = levelParent[l];
              break;
            }
          }
        }

        let parentDepth = rootNode.depth;
        if (parentId !== rootNode.id) {
          const pr = await pool.query('SELECT depth FROM nodes WHERE id=$1', [parentId]);
          parentDepth = pr.rows[0].depth;
        }

        const nid = uuid();
        await pool.query(
          `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
           VALUES ($1,$2,$3,$4,'',0,0,$5)`,
          [nid, rootNode.canvas_id, parentId, item.label, parentDepth + 1]
        );
        levelParent[item.level] = nid;
        for (let l = item.level + 1; l <= 20; l++) delete levelParent[l];
        created.push(nid);
        await indexNode(nid);
      }

      await pool.query(
        `UPDATE attachments SET status='applied', applied_action='append_nodes', extracted_text=$1 WHERE id=$2`,
        [text.trim(), att.id]
      );
      return res.json({ action: 'append_nodes', applied: true, created_count: created.length });
    }

    // default: 'store' — leave the text as-is on the attachment
    await pool.query(
      `UPDATE attachments SET status='applied', applied_action='store', extracted_text=$1 WHERE id=$2`,
      [text.trim(), att.id]
    );
    await indexNode(att.node_id);
    res.json({ action: 'store', applied: true });
  } catch (e) {
    next(e);
  }
});

// Delete an attachment (removes the stored file too)
router.delete('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM attachments WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Attachment not found' });
    await storage.remove(rows[0].storage_key);
    await pool.query('DELETE FROM attachments WHERE id=$1', [req.params.id]);
    await indexNode(rows[0].node_id);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});

module.exports = router;
