const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const activations = require('../services/activations');
const audit = require('../services/audit');
const sms = require('../services/sms');
const config = require('../config');
const { serializeActivation } = require('./serializers');
const HttpError = require('../utils/httpError');

const router = express.Router();
const CONFIRMATION_PHRASE = 'SEND MY MESSAGES';

// Counted per account, so retries from different networks don't get extra attempts.
const triggerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user.id, message: { error: 'Too many trigger attempts. Try again later.' } });

async function verifyPassword(req, action) {
  const ok = typeof req.body.password === 'string' && (await bcrypt.compare(req.body.password, req.user.password_hash));
  if (!ok) {
    await audit.record({ userId: req.user.id, actorId: req.user.id, action: `${action}.password_rejected`, ip: req.ip });
    // 403, not 401: the session is fine, so the client must not sign the user out.
    throw new HttpError(403, 'Password is incorrect');
  }
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM activations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]
    );
    res.json({
      activations: rows.map(serializeActivation),
      current: rows.map(serializeActivation).find((a) => activations.OPEN_STATUSES.includes(a.status)) || null,
      smsMode: sms.isLive() ? 'live' : 'mock',
      notificationsEnabled: config.notificationsEnabled,
      confirmationPhrase: CONFIRMATION_PHRASE,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/deliveries', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT d.status, d.error, d.created_at, d.contact_id, d.template_id FROM deliveries d
         JOIN activations a ON a.id = d.activation_id
        WHERE a.id = $1 AND a.user_id = $2 ORDER BY d.created_at`,
      [req.params.id, req.user.id]
    );
    res.json({ deliveries: rows });
  } catch (err) {
    next(err);
  }
});

// Manual trigger. Three independent checks: the account password, an exact
// typed phrase, and a delay before anything is sent during which it can be cancelled.
router.post('/',
  triggerLimiter,
  body('password').isString().notEmpty(),
  body('confirmationPhrase').isString(),
  validate,
  async (req, res, next) => {
    try {
      if (req.body.confirmationPhrase !== CONFIRMATION_PHRASE) {
        throw new HttpError(422, `Type "${CONFIRMATION_PHRASE}" exactly to confirm`);
      }
      await verifyPassword(req, 'activation.trigger');
      const activation = await activations.triggerManual(req.user, req.ip);
      res.status(201).json({ activation: serializeActivation(activation) });
    } catch (err) {
      next(err);
    }
  });

router.post('/:id/cancel',
  param('id').isUUID(),
  body('password').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      await verifyPassword(req, 'activation.cancel');
      const { rows } = await db.query('SELECT * FROM activations WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
      if (!rows[0]) throw new HttpError(404, 'Activation not found');
      const activation = await activations.cancel(rows[0], req.user, 'cancelled_by_user', req.ip);
      res.json({ activation: serializeActivation(activation) });
    } catch (err) {
      next(err);
    }
  });

module.exports = router;
