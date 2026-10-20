const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const clock = require('../utils/clock');
const HttpError = require('../utils/httpError');

const ACTIVITY_WRITE_INTERVAL_MS = 5 * 60 * 1000;

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Authentication required');

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret);
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    // token_version lets a password change sign out every other device.
    if (!user || user.token_version !== payload.tv) throw new HttpError(401, 'Session is no longer valid');

    // Any signed-in activity counts as being alive for the inactivity rule.
    const now = clock.now();
    if (now - new Date(user.last_active_at) > ACTIVITY_WRITE_INTERVAL_MS) {
      await db.query('UPDATE users SET last_active_at = $2 WHERE id = $1', [user.id, now]);
      user.last_active_at = now;
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : next(new HttpError(403, 'Insufficient permissions'));

module.exports = { authenticate, requireRole, signToken };
