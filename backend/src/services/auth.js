const jwt = require('jsonwebtoken');
const config = require('../config');

// Issue a JWT for a user row. `sub` is the user id.
function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.auth.jwtSecret, {
    expiresIn: config.auth.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.auth.jwtSecret);
}

// Optional auth: attach req.user when a valid Bearer token is present.
function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  req.user = null;
  if (header.startsWith('Bearer ')) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch (e) {
      // invalid token -> treat as anonymous
    }
  }
  next();
}

// Require a valid token; otherwise 401.
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    req.user = verifyToken(header.slice(7));
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  next();
}

module.exports = { signToken, verifyToken, authOptional, authRequired };
