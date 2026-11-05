const express = require('express');
const { pool } = require('../db');
const { uuid, parseExtractedText } = require('../util');
const { indexNode } = require('../services/indexer');
const ai = require('../ai');
const { parseTree } = require('../jsonParse');
const storage = require('../storage');
const es = require('../es');

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
    const { node_id, question, model } = req.body || {};
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

    const { content } = await ai.chatCompletion(messages, { provider: model, maxTokens: 8000, temperature: 0.2 });

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
  'points and may be an empty string; use "children" for sub-topics; keep maximum depth 8 and maximum ' +
  '100 total nodes; the root label should reflect the overall theme. The response MUST be one complete, ' +
  'valid JSON object — never truncate mid-object. If the subject is too large to cover fully, include ' +
  'the most important topics rather than cutting the JSON off.';

const MAP_FROM_ANSWER_SYSTEM =
  'You are an expert UPSC syllabus mind-map generator. Convert the provided answer text into a ' +
  'structured brain-map tree. Respond with ONLY a valid JSON object (no markdown fences, no extra text) ' +
  'in exactly this shape:\n' +
  '{"root":{"label":"string","content":"string","children":[{"label":"string","content":"string","children":[]}]}}\n' +
  'Rules:\n' +
  '- "label" is a concise topic title (max 8 words) — this becomes the NODE NAME.\n' +
  '- "content" is a 1-3 sentence description or the key points — this becomes the NODE NOTES. ' +
  'Do NOT leave content empty when the answer provides detail.\n' +
  '- Turn the answer\'s main idea into "root"; turn each top-level bullet/sub-topic into a child node; ' +
  'turn nested bullets into nested children.\n' +
  '- Keep maximum depth 6 and maximum 40 nodes. Respond with one complete, valid JSON object.';

const REARRANGE_KEEP_SYSTEM =
  'You are an expert UPSC mind-map organizer. You are given a list of topic nodes (each with a ref id, ' +
  'title, and description). Rearrange them into a clearer hierarchy based ONLY on the relationships between ' +
  'their titles and descriptions. KEEP every node\'s title and description EXACTLY unchanged — you may ONLY ' +
  'change parent-child relationships. Respond with ONLY a valid JSON object (no markdown fences, no extra ' +
  'text) in exactly this shape:\n' +
  '{"root":{"ref":"string","children":[{"ref":"string","children":[]}]}}\n' +
  'where each "ref" is the exact ref id (e.g. n0, n1) of a node from the provided list. Every provided node ' +
  'must appear exactly once. If nodes are independent, place them as parallel siblings; if one is a sub-topic ' +
  'of another, nest it as a child.';

const REARRANGE_MODIFY_SYSTEM =
  'You are an expert UPSC mind-map organizer and editor. You are given a list of topic nodes (title and ' +
  'description). Rearrange them into a clearer hierarchy AND enrich/improve each node\'s title and description ' +
  'to be more accurate and useful for UPSC preparation. Respond with ONLY a valid JSON object (no markdown ' +
  'fences, no extra text) in exactly this shape:\n' +
  '{"root":{"label":"string","content":"string","children":[{"label":"string","content":"string","children":[]}]}}\n' +
  'where "label" is a concise title and "content" is a description/notes. Cover every topic from the input. ' +
  'If topics are independent, make them parallel siblings; if one is a sub-topic of another, nest it as a child.';

const DEFAULT_REARRANGE_PROMPT =
  'Break all child Nodes into individual Nodes, and then based on Title of each of those individual Nodes ' +
  'and description, Connect them based on their relationship. If they are independent, then should exist ' +
  'parallel to each other. If they are somehow connected then connect them sequentially.';

// Use the AI itself to turn an answer into a structured map tree.
async function generateMapTree(text, provider) {
  const messages = [
    { role: 'system', content: MAP_FROM_ANSWER_SYSTEM },
    { role: 'user', content: `Answer text:\n\n${String(text || '').trim()}` },
  ];
  const { content } = await ai.chatCompletion(messages, {
    provider,
    maxTokens: 12000,
    temperature: 0.2,
    json: true,
  });
  return parseTree(content);
}

// Flatten an answer into nodes, falling back to the heuristic parser if AI fails.
async function buildFlatFromAnswer(text, provider) {
  try {
    const tree = await generateMapTree(text, provider);
    return flatten(tree);
  } catch (e) {
    console.warn('[ai/apply] AI map generation failed, falling back to text parser:', e.message);
    const parsed = parseExtractedText(text);
    return parsed.length ? parsedToFlat(parsed) : [];
  }
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
    const { canvas_id, prompt, node_id, model } = req.body || {};
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
      provider: model,
      maxTokens: 12000,
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

// POST /api/ai/apply  { node_id, text, action: 'notes' | 'child' | 'map' | 'canvas' }
// Applies an AI answer into the brain map.
router.post('/apply', async (req, res, next) => {
  try {
    const { node_id, text, action, mode, author, model } = req.body || {};
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
      const flat = await buildFlatFromAnswer(text, model);
      if (!flat.length) {
        return res.status(400).json({ error: 'Could not generate a map from this answer.' });
      }
      const positions = computePositions(flat);
      const idByIndex = [];
      for (let i = 0; i < flat.length; i++) {
        const item = flat[i];
        const parentId = item.parentRef >= 0 ? idByIndex[item.parentRef] : node_id;
        const id = uuid();
        await pool.query(
          `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            rootNode.canvas_id,
            parentId,
            item.label,
            item.content,
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

    if (action === 'canvas') {
      const flat = await buildFlatFromAnswer(text, model);
      if (!flat.length) {
        return res.status(400).json({ error: 'Could not generate a map from this answer.' });
      }

      // Derive a readable name + short description for the new canvas.
      const rawLines = String(text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const canvasName =
        (flat[0] && flat[0].label ? String(flat[0].label).slice(0, 100) : '') ||
        (rawLines[0] || '')
          .replace(/^#{1,6}\s*/, '')
          .replace(/^[-*•▪◦▫]\s*/, '')
          .replace(/^\d{1,2}[.)]\s*/, '')
          .trim()
          .slice(0, 100) ||
        `${rootNode.label} — Map`;
      const description = rawLines.slice(0, 3).join(' ').slice(0, 240);

      // 1) Create the new canvas and populate it with the generated map.
      const newCanvasId = uuid();
      await pool.query('INSERT INTO canvases (id, name, description) VALUES ($1,$2,$3)', [
        newCanvasId,
        canvasName,
        description,
      ]);

      const positions = computePositions(flat);
      const idByIndex = [];
      for (let i = 0; i < flat.length; i++) {
        const item = flat[i];
        const parentId = item.parentRef >= 0 ? idByIndex[item.parentRef] : null;
        const id = uuid();
        await pool.query(
          `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, newCanvasId, parentId, item.label, item.content, positions[i].x, positions[i].y, item.depth]
        );
        idByIndex[i] = id;
        await indexNode(id);
      }

      // 2) Link the new canvas back to the current topic via a child node.
      const childCount = await pool.query('SELECT count(*)::int AS c FROM nodes WHERE parent_id=$1', [node_id]);
      const linkId = uuid();
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth, linked_canvas_id)
         VALUES ($1,$2,$3,$4,'',$5,$6,$7,$8)`,
        [
          linkId,
          rootNode.canvas_id,
          node_id,
          canvasName,
          rootNode.x + 260,
          rootNode.y + childCount.rows[0].c * 90,
          rootNode.depth + 1,
          newCanvasId,
        ]
      );
      await indexNode(linkId);
      await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [rootNode.canvas_id]);

      return res.json({
        action: 'canvas',
        applied: true,
        canvas_id: newCanvasId,
        canvas_name: canvasName,
        node_id: linkId,
        created_count: flat.length,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    next(e);
  }
});

function splitIntoSections(text) {
  const lines = String(text || '').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      current = { level: m[1].length, label: m[2].trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { level: 1, label: 'Summary', lines: [line] };
      sections.push(current);
    }
  }
  return sections.map((s) => ({ level: s.level, label: s.label, content: s.lines.join('\n').trim() }));
}

function sectionsToFlat(sections) {
  const flat = [];
  const levelIndex = {};
  for (const sec of sections) {
    let parentRef = -1;
    for (let l = sec.level - 1; l >= 1; l--) {
      if (levelIndex[l] !== undefined) {
        parentRef = levelIndex[l];
        break;
      }
    }
    const idx = flat.length;
    flat.push({ label: sec.label, content: sec.content, parentRef, depth: sec.level });
    levelIndex[sec.level] = idx;
    for (let l = sec.level + 1; l <= 6; l++) delete levelIndex[l];
  }
  return flat;
}

// Import plain/markdown text into a new (or existing) canvas as a tree of nodes.
router.post('/import-text', async (req, res, next) => {
  try {
    const { text, canvas_name, node_id } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: 'text is required' });

    let canvasId;
    let attachParentId;
    let attachX = 0;
    let attachY = 0;
    let attachDepth = 0;

    if (node_id) {
      const n = await pool.query('SELECT * FROM nodes WHERE id=$1', [node_id]);
      if (!n.rows[0]) return res.status(404).json({ error: 'Node not found' });
      canvasId = n.rows[0].canvas_id;
      attachParentId = node_id;
      attachX = n.rows[0].x;
      attachY = n.rows[0].y;
      attachDepth = n.rows[0].depth;
    } else {
      const name = (canvas_name || 'E-Paper Analysis').trim() || 'E-Paper Analysis';
      canvasId = uuid();
      await pool.query('INSERT INTO canvases (id, name, description) VALUES ($1,$2,$3)', [
        canvasId,
        name,
        '',
      ]);
      const rootId = uuid();
      // Keep the FULL text in the root node's notes so nothing is lost.
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, label, content, x, y, depth) VALUES ($1,$2,$3,$4,0,0,0)`,
        [rootId, canvasId, name, text.trim()]
      );
      await indexNode(rootId);
      attachParentId = rootId;
      attachX = 0;
      attachY = 0;
      attachDepth = 0;
    }

    const sections = splitIntoSections(text);
    if (!sections.length) return res.status(400).json({ error: 'Could not parse the text into topics.' });

    const flat = sectionsToFlat(sections);
    const positions = computePositions(flat);
    const idByIndex = [];
    for (let i = 0; i < flat.length; i++) {
      const item = flat[i];
      const parentId = item.parentRef >= 0 ? idByIndex[item.parentRef] : attachParentId;
      const id = uuid();
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          canvasId,
          parentId,
          item.label,
          item.content,
          attachX + 260 + positions[i].x,
          attachY + positions[i].y,
          attachDepth + item.depth,
        ]
      );
      idByIndex[i] = id;
      await indexNode(id);
    }
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [canvasId]);

    res.json({ canvas_id: canvasId, created_count: flat.length });
  } catch (e) {
    next(e);
  }
});

// Recompute depth for every node of a canvas (recursive CTE from roots).
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

// POST /api/ai/rearrange  { node_id, prompt?, mode: 'keep' | 'modify', model? }
// Rearranges a node's child subtree using AI, based on titles + descriptions.
router.post('/rearrange', async (req, res, next) => {
  try {
    const { node_id, prompt, mode, model } = req.body || {};
    if (!node_id) return res.status(400).json({ error: 'node_id is required' });
    const keep = mode !== 'modify';

    const anchor = await pool.query('SELECT * FROM nodes WHERE id=$1', [node_id]);
    if (!anchor.rows[0]) return res.status(404).json({ error: 'Node not found' });
    const a = anchor.rows[0];

    // Load all descendants of the anchor node.
    const desc = await pool.query(
      `WITH RECURSIVE sub AS (
         SELECT id, parent_id, label, content, depth FROM nodes WHERE parent_id = $1
         UNION ALL
         SELECT n.id, n.parent_id, n.label, n.content, n.depth
         FROM nodes n JOIN sub s ON n.parent_id = s.id
       ) SELECT id, parent_id, label, content, depth FROM sub`,
      [node_id]
    );
    const nodes = desc.rows;
    if (!nodes.length) {
      return res.status(400).json({ error: 'This topic has no child nodes to rearrange.' });
    }

    const refToId = {};
    const list = nodes.map((n, i) => {
      const ref = `n${i}`;
      refToId[ref] = n.id;
      return { ref, title: n.label, description: n.content || '' };
    });

    const promptText = (prompt && prompt.trim()) || DEFAULT_REARRANGE_PROMPT;
    const userContent =
      'User instruction:\n' +
      promptText +
      '\n\nNodes:\n' +
      list.map((n) => `- ${n.ref}: title="${n.title}" description="${n.description}"`).join('\n');

    const messages = [
      { role: 'system', content: keep ? REARRANGE_KEEP_SYSTEM : REARRANGE_MODIFY_SYSTEM },
      { role: 'user', content: userContent },
    ];

    const { content } = await ai.chatCompletion(messages, {
      provider: model,
      maxTokens: 8000,
      json: true,
    });

    const tree = parseTree(content);

    if (keep) {
      // tree = { ref, children } — re-parent the existing nodes only.
      const pairs = [];
      const walk = (root, parentRef) => {
        pairs.push({ ref: root.ref, parentRef });
        for (const child of Array.isArray(root.children) ? root.children : []) {
          if (child && typeof child === 'object') walk(child, root.ref);
        }
      };
      walk(tree, null);

      let updated = 0;
      for (const p of pairs) {
        const id = refToId[p.ref];
        if (!id) continue;
        const parentId = p.parentRef && refToId[p.parentRef] ? refToId[p.parentRef] : node_id;
        await pool.query('UPDATE nodes SET parent_id=$1, updated_at=now() WHERE id=$2', [parentId, id]);
        updated++;
      }
      await recomputeDepths(a.canvas_id);
      await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [a.canvas_id]);
      return res.json({ action: 'rearrange', mode: 'keep', applied: true, rearranged: updated });
    }

    // modify mode: delete the old subtree and recreate it from the enriched tree.
    const subtreeCte = `WITH RECURSIVE sub AS (
       SELECT id FROM nodes WHERE parent_id = $1
       UNION ALL
       SELECT n.id FROM nodes n JOIN sub s ON n.parent_id = s.id
     ) SELECT id FROM sub`;

    const att = await pool.query(
      `SELECT a.storage_key FROM attachments a WHERE a.node_id IN (${subtreeCte})`,
      [node_id]
    );
    const ids = await pool.query(subtreeCte, [node_id]);

    await pool.query(`DELETE FROM nodes WHERE id IN (${subtreeCte})`, [node_id]);
    for (const r of att.rows) {
      try {
        await storage.remove(r.storage_key);
      } catch (e) {
        // ignore cleanup errors
      }
    }
    for (const r of ids.rows) {
      try {
        await es.removeNode(r.id);
      } catch (e) {
        // ignore
      }
    }

    const flat = flatten(tree);
    const positions = computePositions(flat);
    const idByIndex = [];
    let created = 0;
    for (let i = 0; i < flat.length; i++) {
      const item = flat[i];
      const parentId = item.parentRef >= 0 ? idByIndex[item.parentRef] : node_id;
      const id = uuid();
      await pool.query(
        `INSERT INTO nodes (id, canvas_id, parent_id, label, content, x, y, depth)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          a.canvas_id,
          parentId,
          item.label,
          item.content,
          a.x + 260 + positions[i].x,
          a.y + positions[i].y,
          a.depth + 1 + item.depth,
        ]
      );
      idByIndex[i] = id;
      created++;
      await indexNode(id);
    }
    await recomputeDepths(a.canvas_id);
    await pool.query('UPDATE canvases SET updated_at=now() WHERE id=$1', [a.canvas_id]);
    return res.json({ action: 'rearrange', mode: 'modify', applied: true, created_count: created });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
