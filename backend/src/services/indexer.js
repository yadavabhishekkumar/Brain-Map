const { pool } = require('../db');
const es = require('../es');

/**
 * Re-index a single node (plus its attachments' extracted text) into
 * Elasticsearch. Called after any node/attachment change.
 */
async function indexNode(nodeId) {
  try {
    const { rows } = await pool.query(
      `SELECT n.id, n.canvas_id, n.label, n.content, n.depth,
              COALESCE(string_agg(a.extracted_text, ' '), '') AS extracted
       FROM nodes n
       LEFT JOIN attachments a ON a.node_id = n.id
       WHERE n.id = $1
       GROUP BY n.id`,
      [nodeId]
    );
    if (!rows[0]) {
      await es.removeNode(nodeId);
      return;
    }
    await es.indexNode(rows[0]);
  } catch (e) {
    console.warn('[indexer] failed to index node', nodeId, ':', e.message);
  }
}

module.exports = { indexNode };
