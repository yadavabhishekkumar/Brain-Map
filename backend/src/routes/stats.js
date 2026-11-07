const express = require('express');
const axios = require('axios');
const { pool } = require('../db');
const config = require('../config');
const { authRequired } = require('../services/auth');
const { isSuperUser } = require('../services/access');

const router = express.Router();
router.use(authRequired);
router.use((req, res, next) => {
  if (!isSuperUser(req.user)) {
    return res.status(403).json({ error: 'Statistics are available to super users only' });
  }
  next();
});

// GET /api/stats  -> app/database usage + AI token usage + DeepSeek balance
router.get('/', async (req, res, next) => {
  try {
    // --- App / database usage (row counts + on-disk DB size) ---
    const [users, canvases, nodes, attachments, edges] = await Promise.all([
      pool.query('SELECT count(*)::int AS c FROM users'),
      pool.query('SELECT count(*)::int AS c FROM canvases'),
      pool.query('SELECT count(*)::int AS c FROM nodes'),
      pool.query('SELECT count(*)::int AS c FROM attachments'),
      pool.query('SELECT count(*)::int AS c FROM edges'),
    ]);

    let dbSizeBytes = null;
    try {
      const sz = await pool.query('SELECT pg_database_size(current_database()) AS bytes');
      dbSizeBytes = sz.rows[0] ? Number(sz.rows[0].bytes) : null;
    } catch (e) {
      // Some Postgres providers restrict pg_database_size; leave null.
    }

    // --- AI token usage (last 30 days, aggregated by provider/model) ---
    const usage = await pool.query(
      `SELECT provider, model,
              SUM(prompt_tokens)::int AS prompt_tokens,
              SUM(completion_tokens)::int AS completion_tokens,
              SUM(total_tokens)::int AS total_tokens,
              count(*)::int AS calls
       FROM ai_usage
       WHERE created_at > now() - interval '30 days'
       GROUP BY provider, model
       ORDER BY provider, model`
    );

    // --- DeepSeek balance (best-effort; the only provider with a balance API) ---
    let deepseekBalance = null;
    let deepseekBalanceError = null;
    if (config.deepseek.apiKey) {
      try {
        const url = `${config.deepseek.baseUrl.replace(/\/+$/, '')}/user/balance`;
        const r = await axios.get(url, {
          headers: { Authorization: `Bearer ${config.deepseek.apiKey}` },
          timeout: 10000,
        });
        deepseekBalance = r.data;
      } catch (e) {
        const data = e.response && e.response.data;
        deepseekBalanceError = data
          ? JSON.stringify(data).slice(0, 400)
          : String(e.message || 'unknown error');
      }
    }

    res.json({
      app: {
        users: users.rows[0].c,
        canvases: canvases.rows[0].c,
        nodes: nodes.rows[0].c,
        attachments: attachments.rows[0].c,
        edges: edges.rows[0].c,
      },
      database: {
        size_bytes: dbSizeBytes,
        // NOTE: Neon does not expose RAM/memory usage without the Neon API — the
        // UI should flag this gap rather than invent a number.
      },
      aiUsage: usage.rows,
      deepseekBalance,
      deepseekBalanceError,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
