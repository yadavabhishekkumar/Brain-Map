const { pool } = require('../db');

// Resolve a node id to its owning canvas id (or null).
async function nodeCanvasId(nodeId) {
  const { rows } = await pool.query('SELECT canvas_id FROM nodes WHERE id=$1', [nodeId]);
  return rows[0] ? rows[0].canvas_id : null;
}

// Ensure `user` (from req.user, or null) may WRITE to the canvas.
// Returns an error object on failure, or null on success.
async function requireCanvasOwner(user, canvasId) {
  if (!user) return { status: 401, error: 'Authentication required' };
  const { rows } = await pool.query('SELECT owner_id FROM canvases WHERE id=$1', [canvasId]);
  if (!rows[0]) return { status: 404, error: 'Canvas not found' };
  if (rows[0].owner_id !== user.sub) return { status: 403, error: 'You do not own this canvas' };
  return null;
}

// Ensure `user` may READ the canvas (public, or owned by the user).
async function requireCanvasRead(user, canvasId) {
  const { rows } = await pool.query('SELECT owner_id FROM canvases WHERE id=$1', [canvasId]);
  if (!rows[0]) return { status: 404, error: 'Canvas not found' };
  if (rows[0].owner_id && (!user || rows[0].owner_id !== user.sub)) {
    return { status: 403, error: 'You do not have access to this canvas' };
  }
  return null;
}

module.exports = { nodeCanvasId, requireCanvasOwner, requireCanvasRead };
