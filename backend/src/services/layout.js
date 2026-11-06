const { pool } = require('../db');

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

// Simple left-to-right layout for a flattened tree.
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

// Re-layout the whole canvas into a clean left-to-right tree.
async function relayoutCanvas(canvasId) {
  const { rows } = await pool.query(
    `SELECT id, parent_id, x, y FROM nodes WHERE canvas_id = $1`,
    [canvasId]
  );
  if (!rows.length) return;

  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map();
  const roots = [];
  for (const r of rows) {
    if (r.parent_id && byId.has(r.parent_id)) {
      if (!children.has(r.parent_id)) children.set(r.parent_id, []);
      children.get(r.parent_id).push(r);
    } else {
      roots.push(r);
    }
  }
  children.forEach((v) => v.sort((a, b) => a.y - b.y));
  roots.sort((a, b) => a.y - b.y);

  const flat = [];
  const walk = (node, parentRef) => {
    const idx = flat.length;
    flat.push({ id: node.id, parentRef });
    for (const k of children.get(node.id) || []) walk(k, idx);
  };
  for (const r of roots) walk(r, -1);

  const positions = computePositions(flat);
  for (let i = 0; i < flat.length; i++) {
    await pool.query('UPDATE nodes SET x=$1, y=$2 WHERE id=$3', [
      positions[i].x,
      positions[i].y,
      flat[i].id,
    ]);
  }
}

module.exports = { recomputeDepths, computePositions, relayoutCanvas };
