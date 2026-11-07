const { pool } = require('../db');
const config = require('../config');

// Resolve a node id to its owning canvas id (or null).
async function nodeCanvasId(nodeId) {
  const { rows } = await pool.query('SELECT canvas_id FROM nodes WHERE id=$1', [nodeId]);
  return rows[0] ? rows[0].canvas_id : null;
}

// Super users (e.g. the app creator) are granted elevated rights.
function isSuperUser(user) {
  if (!user || !user.email) return false;
  return config.superUserEmails.includes(String(user.email).toLowerCase());
}

// Can `user` manage (edit/delete) the given canvas row ({ owner_id, is_public }).
// Owners always can; super users can manage any public canvas.
function canManageCanvas(user, canvas) {
  if (!user) return false;
  if (canvas.owner_id === user.sub) return true;
  const isPublic = !canvas.owner_id || canvas.is_public;
  return isSuperUser(user) && isPublic;
}

// Ensure `user` (from req.user, or null) may WRITE to the canvas.
// Returns an error object on failure, or null on success.
async function requireCanvasOwner(user, canvasId) {
  if (!user) return { status: 401, error: 'Authentication required' };
  const { rows } = await pool.query('SELECT owner_id, is_public FROM canvases WHERE id=$1', [canvasId]);
  if (!rows[0]) return { status: 404, error: 'Canvas not found' };
  if (!canManageCanvas(user, rows[0])) return { status: 403, error: 'You do not own this canvas' };
  return null;
}

// Ensure `user` may READ the canvas (public, or owned by the user).
async function requireCanvasRead(user, canvasId) {
  const { rows } = await pool.query('SELECT owner_id, is_public FROM canvases WHERE id=$1', [canvasId]);
  if (!rows[0]) return { status: 404, error: 'Canvas not found' };
  const c = rows[0];
  const isPublic = !c.owner_id || c.is_public;
  if (!isPublic && (!user || c.owner_id !== user.sub)) {
    return { status: 403, error: 'You do not have access to this canvas' };
  }
  return null;
}

module.exports = { nodeCanvasId, requireCanvasOwner, requireCanvasRead, isSuperUser, canManageCanvas };
