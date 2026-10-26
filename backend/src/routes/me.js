const express = require('express');
const bcrypt = require('bcryptjs');
const { body } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const { signToken } = require('../middleware/auth');
const audit = require('../services/audit');
const activations = require('../services/activations');
const { serializeUser } = require('./serializers');
const { passwordRule } = require('./auth');
const { encrypt } = require('../utils/crypto');
const { normalizePhone } = require('../utils/phone');
const HttpError = require('../utils/httpError');

const router = express.Router();

router.get('/', (req, res) => res.json({ user: serializeUser(req.user) }));

const FIELDS = {
  name: 'name',
  inactivityEnabled: 'inactivity_enabled',
  inactivityDays: 'inactivity_days',
  checkinGraceHours: 'checkin_grace_hours',
  dispatchDelayHours: 'dispatch_delay_hours',
  requireAdminConfirmation: 'require_admin_confirmation',
  requireTrusteeConfirmation: 'require_trustee_confirmation',
  remindersEnabled: 'reminders_enabled',
  reminderIntervalDays: 'reminder_interval_days',
  reminderLookaheadDays: 'reminder_lookahead_days',
};

router.patch('/',
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('phone').optional({ values: 'null' }).isString(),
  body('inactivityEnabled').optional().isBoolean(),
  body('inactivityDays').optional().isInt({ min: 7, max: 365 }),
  body('checkinGraceHours').optional().isInt({ min: 24, max: 720 }),
  body('dispatchDelayHours').optional().isInt({ min: 1, max: 168 }),
  body('requireAdminConfirmation').optional().isBoolean(),
  body('requireTrusteeConfirmation').optional().isBoolean(),
  body('remindersEnabled').optional().isBoolean(),
  body('reminderIntervalDays').optional().isInt({ min: 1, max: 30 }),
  body('reminderLookaheadDays').optional().isInt({ min: 0, max: 60 }),
  validate,
  async (req, res, next) => {
    try {
      const updates = {};
      for (const [key, column] of Object.entries(FIELDS)) {
        if (req.body[key] !== undefined) updates[column] = req.body[key];
      }
      if (req.body.phone !== undefined) {
        if (req.body.phone === null || req.body.phone === '') {
          updates.phone_enc = null;
        } else {
          const phone = normalizePhone(req.body.phone);
          if (!phone) throw new HttpError(422, 'Enter a valid phone number, e.g. +15551234567');
          updates.phone_enc = encrypt(phone);
        }
      }
      const enabling = (updates.inactivity_enabled === true && !req.user.inactivity_enabled)
        || (updates.reminders_enabled === true && !req.user.reminders_enabled);
      if (enabling && !(updates.phone_enc ?? req.user.phone_enc)) {
        throw new HttpError(422, 'Add your own phone number first so reminders can reach you');
      }
      if (updates.require_trustee_confirmation === true && !req.user.require_trustee_confirmation) {
        const { rows: [{ n }] } = await db.query(
          "SELECT count(*)::int AS n FROM trustees WHERE owner_id = $1 AND status = 'accepted' AND can_confirm", [req.user.id]
        );
        if (n === 0) throw new HttpError(422, 'Add an emergency contact who can confirm, and wait for them to accept, first');
      }
      const keys = Object.keys(updates);
      if (keys.length === 0) return res.json({ user: serializeUser(req.user) });

      const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
      const { rows } = await db.query(
        `UPDATE users SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
        [req.user.id, ...keys.map((k) => updates[k])]
      );
      await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'user.settings_updated',
        details: { fields: keys.filter((k) => k !== 'phone_enc').concat(updates.phone_enc !== undefined ? ['phone'] : []) },
        ip: req.ip });
      res.json({ user: serializeUser(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

router.post('/check-in', async (req, res, next) => {
  try {
    const cancelled = await activations.cancelInactivityRuns(req.user, 'user_checked_in', req.ip);
    await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'user.checked_in', ip: req.ip });
    res.json({ ok: true, cancelledInactivityRuns: cancelled });
  } catch (err) {
    next(err);
  }
});

router.post('/password',
  body('currentPassword').isString().notEmpty(),
  passwordRule,
  validate,
  async (req, res, next) => {
    try {
      if (!(await bcrypt.compare(req.body.currentPassword, req.user.password_hash))) {
        throw new HttpError(403, 'Current password is incorrect');
      }
      const hash = await bcrypt.hash(req.body.password, 12);
      const { rows } = await db.query(
        'UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = now() WHERE id = $1 RETURNING *',
        [req.user.id, hash]
      );
      await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'user.password_changed', ip: req.ip });
      res.json({ token: signToken(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

module.exports = router;
