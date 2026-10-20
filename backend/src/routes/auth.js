const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const db = require('../db');
const config = require('../config');
const validate = require('../middleware/validate');
const { signToken } = require('../middleware/auth');
const audit = require('../services/audit');
const activations = require('../services/activations');
const { serializeUser } = require('./serializers');
const clock = require('../utils/clock');
const HttpError = require('../utils/httpError');

const router = express.Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authRateLimit, standardHeaders: true, legacyHeaders: false }));

const passwordRule = body('password')
  .isLength({ min: 10 }).withMessage('Password must be at least 10 characters')
  .matches(/[A-Za-z]/).withMessage('Password must include a letter')
  .matches(/[0-9]/).withMessage('Password must include a number');

router.post('/register',
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 1, max: 100 }),
  passwordRule,
  validate,
  async (req, res, next) => {
    try {
      const hash = await bcrypt.hash(req.body.password, 12);
      const { rows } = await db.query(
        'INSERT INTO users (email, password_hash, name, last_active_at) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING RETURNING *',
        [req.body.email, hash, req.body.name, clock.now()]
      );
      if (!rows[0]) throw new HttpError(409, 'An account with that email already exists');
      await audit.record({ userId: rows[0].id, actorId: rows[0].id, action: 'user.registered', ip: req.ip });
      res.status(201).json({ token: signToken(rows[0]), user: serializeUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

router.post('/login',
  body('email').isEmail().normalizeEmail(),
  body('password').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [req.body.email]);
      const user = rows[0];
      const ok = user && (await bcrypt.compare(req.body.password, user.password_hash));
      if (!ok) throw new HttpError(401, 'Invalid email or password');
      await db.query('UPDATE users SET last_active_at = $2 WHERE id = $1', [user.id, clock.now()]);
      const cancelled = await activations.cancelInactivityRuns(user, 'user_signed_in', req.ip);
      await audit.record({ userId: user.id, actorId: user.id, action: 'user.login', ip: req.ip });
      res.json({ token: signToken(user), user: serializeUser(user), cancelledInactivityRuns: cancelled });
    } catch (err) {
      next(err);
    }
  });

module.exports = { router, passwordRule };
