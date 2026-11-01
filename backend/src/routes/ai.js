const express = require('express');
const { pool } = require('../db');
const { uuid, parseExtractedText } = require('../util');
const { indexNode } = require('../services/indexer');
const ai = require('../ai');

const router = express.Router();

// Build a context string from a node and its ancestors (root -> ... -> node).
async function buildAncestorContext(nodeId) {
  const { rows } = await pool.query(
    `WITH RECURSIVE anc AS (
       SELECT id, label, content, depth, parent_id FROM nodes WHERE id = $1
       UNION ALL
       SELECT p.id, p.label, p.content, p.depth, p.parent_id
       FROM nodes p JOIN anc a ON p.id = a.parent_id
     )
     SELECT * FROM anc ORDER BY depth ASC`,
    [nodeId]
  );
  if (!rows.length) return '';
  return rows
    .map((r) => {
      const heading = '#'.repeat(Math.min((r.depth || 0) + 1, 6));
      const parts = [`${heading} ${r.label}`];
      if (r.content && r.content.trim()) parts.push(r.content.trim());
      return parts.join('\n');
    })
    .join('\n\n');
}

// POST /api/ai/ask  { node_id, question }
router.post('/ask', async (req, res, next) => {
  try {
    const { node_id, question } = req.body || {};
    if (!node_id) return res.status(400).json({ error: 'node_id is required' });
    if (!question || !question.trim()) return res.status(400).json({ error: 'question is required' });

    const context = await buildAncestorContext(node_id);
    if (!context) return res.status(404).json({ error: 'Node not found' });

    const messages = [
      {
        role: 'system',
        content:
          'You are a knowledgeable UPSC (Union Public Service Commission) exam preparation assistant. ' +
          'Answer the student\'s question accurately and concisely, grounded in the provided study ' +
          'context (the selected topic and its parent topics). If the context does not contain the ' +
          'answer, say so briefly and then answer from general knowledge.',
      },
      { role: 'user', content: `Study context:\n\n${context}\n\nStudent's question: ${question.trim()}` },
    ];

    const { content } = await ai.chatCompletion(messages, { maxTokens: 2000, temperature: 0.2 });

    const chatId = uuid();
    await pool.query(
      `INSERT INTO node_chats (id, node_id, question, answer, author) VALUES ($1,$2,$3,$4,'You')`,
      [chatId, node_id, question.trim(), content]
    );

    res.json({ answer: content, chat_id: chatId });
  } catch (e) {
    next(e);
  }
});

const BUILD_SYSTEM =
  'You are an expert UPSC syllabus mind-map generator. Convert the user\'s request into a ' +
  'structured brain-map tree. Respond with ONLY a valid JSON object (no markdown fences, no extra text) ' +
  'in exactly this shape:\n' +
  '{"root":{"label":"string","content":"string","children":[{"label":"string","content":"string","children":[]}]}}\n' +
  'Rules: "label" is a concise topic title (max 10 words); "content" is a 1-3 sentence summary or key ' +
  'points and may be an empty string; use "children" for sub-topics; keep maximum depth 6 and maximum ' +
  '40 total nodes; the root label should reflect the overall theme.';

function stripFences(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  return t.trim();
}

function parseTree(content) {
  const data = JSON.parse(stripFences(content));
  const root = data && data.root ? data.root : data;
  if (!root || typeof root !== 'object') throw new Error('unexpected structure');
  return root;
}

// Flatten a nested tree into [{label, content, parentRef, depth}] (parentRef = index in list, -1 = root)
function flatten(root, list = [], parentRef = -1, depth = 0) {
  if (list.length >= 120 || depth > 8) return list;
  const idx = list.length;
  list.push({
    label: String(root.label || 'Topic').slice(0, 300),
    content: String(root.content || '').slice(0, 4000),
    parentRef,
    depth,
  });
  const children = Array.isArray(root.children) ? root.children : [];
  for (const child of children) {
    if (child && typeof child === 'object') flatten(child, list, idx, depth + 1);
  }
  return list;
}

// Simple left-to-right layout for the flattened tree.
function computePositions(flat) {
  const children = new Map();
  flat.forEach((n, i) => {
    if (n.parentRef >= 0) {
      if (!children.has(n.parentRef)) children.set(n.parentRef, []);
      children.get(n.parentRef).push(i);
    }
  });
  const V_GAP = 90;
  const H_GAP = 260;
  const subtreeHeight = (i) => {
    const kids = children.get(i) || [];
    if (kids.length === 0) return V_GAP;
    return kids.reduce((s, k) => s + subtreeHeight(k), 0);
  };
  const pos = new Array(flat.length);
  const place = (i, x, yTop) => {
    const kids = children.get(i) || [];
    const h = subtreeHeight(i);
    pos[i] = { x, y: yTop + h / 2 };
    let cy = yTop;
    for (const k of kids) {
      place(k, x + H_GAP, cy);
      cy += subtreeHeight(k);
    }
  };
  let rootY = 0;
  flat.forEach((n, i) => {
    if (n.parentRef < 0) {
      place(i, 0, rootY);
      rootY += subtreeHeight(i) + V_GAP;
    }
  });
  return pos;
}

// POST /api/ai/build  { canvas_id, prompt, node_id? }
router.post('/build', async (req, res, next) => {
  try {
    const { canvas_id, prompt, node_id } = req.body || {};
    if (!canvas_id) return res.status(400).json({ error: 'canvas_id is required' });
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt is required' });

    let attachParentId = null;
    let attachDepth = 0;
    if (node_id) {
      const p = await pool.query('SELECT id, depth FROM nodes WHERE id=$1 AND canvas_id=$2', [
        node_id,
        canvas_id,
      ]);
      if (!p.rows[0]) return res.status(404).json({ error: 'Attachment node not found' });
      attachParentId = p.rows[0].id;
      attachDepth = p.rows[0].depth;
    }

    const messages = [
      { role: 'system', content: BUILD_SYSTEM },
      { role: 'user', content: `User request:\n${prompt.trim()}` },
    ];
    const { content } = await ai.chatCompletion(messages, {
      maxTokens: 4000,
      temperature: 0.2,
      json: true,
    });

    let tree;
    try {
      tree = parseTree(content);
    } catch (e) {
      return res
        .status(502)
        .json({ error: 'The AI did not return valid JSON. Please rephrase your request.', detail: content.slice(0, 400) });
    }

    const flat = flatten(tree);
    if (!flat.length) return res.status(502).json({ error: 'The AI returned an empty map.' });

    const positions = computePositions(flat);
    const idByIndex = [];
    let created = 0;
    for (let i = 0; i < flat.length; i++) {
      const item = flat[i];
      let parentId = null;
      if (item.parentRef >= 0) {
        parentId = idByIndex[item.parentRef];
      } else {
        parentId = attachParentId;
      }
      const depth = attachParentId ? attachDepth + 1 + item.depth : item.depth;
      const id = uuid();
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, canvas_id, parentId, item.label, item.content, positions[i].x, positions[i].y, depth]
      );
      idByIndex[i] = id;
      created++;
      await indexNode(id);
    }
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [canvas_id]);

    res.json({ created, nodes: idByIndex });
  } catch (e) {
    next(e);
  }
});
// Convert parseExtractedText output [{label, level}] into a flat list with parentRef indices.
function parsedToFlat(parsed) {
  const flat = [];
  const levelIndex = {};
  for (const item of parsed) {
    let parentRef = -1;
    if (item.level > 0) {
      for (let l = item.level - 1; l >= 0; l--) {
        if (levelIndex[l] !== undefined) {
          parentRef = levelIndex[l];
          break;
        }
      }
    }
    const idx = flat.length;
    flat.push({ label: item.label, content: '', parentRef, depth: item.level });
    levelIndex[item.level] = idx;
    for (let l = item.level + 1; l <= 20; l++) delete levelIndex[l];
  }
  return flat;
}

function buildSeparator(author) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `\n\n---\n${ts} · ${author}\n\n`;
}

// POST /api/ai/apply  { node_id, text, action: 'notes' | 'child' | 'map' }
// Applies an AI answer into the brain map.
router.post('/apply', async (req, res, next) => {
  try {
    const { node_id, text, action, mode, author } = req.body || {};
    if (!node_id) return res.status(400).json({ error: 'node_id is required' });
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

    const node = await pool.query('SELECT * FROM nodes WHERE id=$1', [node_id]);
    if (!node.rows[0]) return res.status(404).json({ error: 'Node not found' });
    const rootNode = node.rows[0];

    if (action === 'notes') {
      const applyMode = mode === 'override' ? 'override' : 'append';
      const authorName = String(author || 'You').trim() || 'You';
      const existing = rootNode.content || '';
      let newContent;
      if (applyMode === 'override') {
        newContent = text.trim();
      } else if (existing.trim()) {
        newContent = existing + buildSeparator(authorName) + text.trim();
      } else {
        newContent = text.trim();
      }
      await pool.query('UPDATE nodes SET content=$1, updated_at=now() WHERE id=$2', [newContent, node_id]);
      await indexNode(node_id);
      return res.json({ action: 'notes', applied: true, mode: applyMode });
    }

    if (action === 'child') {
      const childCount = await pool.query('SELECT count(*)::int AS c FROM nodes WHERE parent_id=$1', [
        node_id,
      ]);
      const label =
        (text.trim().split('\n')[0] || '').replace(/^#+\s*/, '').trim().slice(0, 80) || 'AI answer';
      const id = uuid();
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          rootNode.canvas_id,
          node_id,
          label,
          text.trim(),
          rootNode.x + 260,
          rootNode.y + childCount.rows[0].c * 90,
          rootNode.depth + 1,
        ]
      );
      await indexNode(id);
      await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [rootNode.canvas_id]);
      return res.json({ action: 'child', applied: true, node_id: id });
    }

    if (action === 'map') {
      const parsed = parseExtractedText(text);
      if (!parsed.length) {
        return res.status(400).json({ error: 'Could not parse the response into topics.' });
      }
      const flat = parsedToFlat(parsed);
      const positions = computePositions(flat);
      const idByIndex = [];
      for (let i = 0; i < flat.length; i++) {
        const item = flat[i];
        const parentId = item.parentRef >= 0 ? idByIndex[item.parentRef] : node_id;
        const id = uuid();
        await pool.query(
          `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
           VALUES ($1,$2,$3,$4,'',$5,$6,$7)`,
          [
            id,
            rootNode.canvas_id,
            parentId,
            item.label,
            rootNode.x + 260 + positions[i].x,
            rootNode.y + positions[i].y,
            rootNode.depth + 1 + item.depth,
          ]
        );
        idByIndex[i] = id;
        await indexNode(id);
      }
      await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [rootNode.canvas_id]);
      return res.json({ action: 'map', applied: true, created_count: flat.length });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
