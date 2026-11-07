const { pool } = require('../db');

// Generate a short hash-like suffix (lowercase alphanumeric).
function hashId(length = 6) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < length; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}

// Ensure a canvas name is unique within the user's visible scope:
//   - every public canvas (owner_id IS NULL OR is_public), and
//   - the user's own private canvases.
// Other users' private canvases are ignored. If the name already exists, a short
// hashId suffix is appended. `excludeId` is the canvas being renamed so it never
// clashes with itself. Returns the final (possibly suffixed) name.
async function uniqueCanvasName(name, userId, excludeId = null) {
  const base = (name || '').trim() || 'Untitled canvas';
  let candidate = base;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { rows } = await pool.query(
      `SELECT 1 FROM canvases
       WHERE lower(name) = lower($1)
         AND (owner_id IS NULL OR is_public = true OR owner_id = $2)
         AND ($3::uuid IS NULL OR id <> $3::uuid)
       LIMIT 1`,
      [candidate, userId, excludeId]
    );
    if (rows.length === 0) return candidate;
    candidate = `${base} - ${hashId()}`;
  }
  // Extremely unlikely fallback.
  return `${base} - ${hashId(10)}`;
}

module.exports = { uniqueCanvasName, hashId };
