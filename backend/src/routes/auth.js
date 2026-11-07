const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const { pool } = require('../db');
const { uuid } = require('../util');
const { signToken, authRequired } = require('../services/auth');
const { isSuperUser } = require('../services/access');
const config = require('../config');

const router = express.Router();
const googleClient = new OAuth2Client(config.auth.googleClientId);

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    is_superuser: isSuperUser(row),
  };
}

// POST /api/auth/signup  { email, password, name }
router.post('/signup', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const name = (req.body.name || '').trim();
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
    if (existing.rows[0]) return res.status(409).json({ error: 'An account with this email already exists' });

    const id = uuid();
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)', [
      id,
      email,
      name || email.split('@')[0],
      hash,
    ]);
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    res.status(201).json({ token: signToken(rows[0]), user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/login  { email, password }
router.post('/login', async (req, res, next) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    const user = rows[0];
    if (!user || !user.password_hash) return res.status(401).json({ error: 'Invalid email or password' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/google  { idToken }
router.post('/google', async (req, res, next) => {
  try {
    const idToken = req.body.idToken || req.body.credential || '';
    if (!idToken) return res.status(400).json({ error: 'Missing Google credential' });
    if (!config.auth.googleClientId) return res.status(500).json({ error: 'Google sign-in is not configured (set GOOGLE_CLIENT_ID)' });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: config.auth.googleClientId });
    const payload = ticket.getPayload();
    const email = (payload.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Google account has no email' });
    const name = payload.name || email.split('@')[0];
    const picture = payload.picture || '';

    let user = (await pool.query('SELECT * FROM users WHERE google_id=$1', [payload.sub])).rows[0];
    if (!user) user = (await pool.query('SELECT * FROM users WHERE email=$1', [email])).rows[0];
    if (!user) {
      const id = uuid();
      await pool.query('INSERT INTO users (id, email, name, google_id, avatar) VALUES ($1,$2,$3,$4,$5)', [
        id,
        email,
        name,
        payload.sub,
        picture,
      ]);
      user = (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0];
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/me  -> current user
router.get('/me', authRequired, async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: publicUser(rows[0]) });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
