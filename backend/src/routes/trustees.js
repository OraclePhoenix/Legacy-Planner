const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, param } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const audit = require('../services/audit');
const activations = require('../services/activations');
const { serializeActivation } = require('./serializers');
const HttpError = require('../utils/httpError');

const router = express.Router();

const serializeTrustee = (t) => ({
  id: t.id,
  email: t.email,
  name: t.trustee_name || null,
  status: t.status,
  canReport: t.can_report,
  canConfirm: t.can_confirm,
  createdAt: t.created_at,
});

const reportLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.user.id, message: { error: 'Too many attempts. Try again later.' } });

async function verifyPassword(req) {
  const ok = typeof req.body.password === 'string' && (await bcrypt.compare(req.body.password, req.user.password_hash));
  if (!ok) throw new HttpError(403, 'Password is incorrect');
}

// ---- Owner side: the people I trust ---------------------------------------

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT t.*, u.name AS trustee_name FROM trustees t LEFT JOIN users u ON u.id = t.trustee_id
        WHERE t.owner_id = $1 ORDER BY t.created_at`,
      [req.user.id]
    );
    res.json({ trustees: rows.map(serializeTrustee) });
  } catch (err) {
    next(err);
  }
});

router.post('/',
  body('email').isEmail().normalizeEmail(),
  body('canReport').optional().isBoolean(),
  body('canConfirm').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      if (req.body.email === req.user.email) throw new HttpError(422, 'You cannot add yourself');
      const { rows } = await db.query(
        `INSERT INTO trustees (owner_id, email, can_report, can_confirm) VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, email) DO NOTHING RETURNING *`,
        [req.user.id, req.body.email, req.body.canReport ?? true, req.body.canConfirm ?? false]
      );
      if (!rows[0]) throw new HttpError(409, 'That person is already on your list');
      await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'trustee.added',
        details: { email: req.body.email }, ip: req.ip });
      res.status(201).json({ trustee: serializeTrustee(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

router.patch('/:id',
  param('id').isUUID(),
  body('canReport').optional().isBoolean(),
  body('canConfirm').optional().isBoolean(),
  validate,
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `UPDATE trustees SET can_report = COALESCE($3, can_report), can_confirm = COALESCE($4, can_confirm), updated_at = now()
          WHERE id = $1 AND owner_id = $2 RETURNING *`,
        [req.params.id, req.user.id, req.body.canReport ?? null, req.body.canConfirm ?? null]
      );
      if (!rows[0]) throw new HttpError(404, 'Emergency contact not found');
      await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'trustee.updated',
        details: { email: rows[0].email, canReport: rows[0].can_report, canConfirm: rows[0].can_confirm }, ip: req.ip });
      res.json({ trustee: serializeTrustee(rows[0]) });
    } catch (err) {
      next(err);
    }
  });

router.delete('/:id', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const { rows } = await db.query('DELETE FROM trustees WHERE id = $1 AND owner_id = $2 RETURNING email', [req.params.id, req.user.id]);
    if (!rows[0]) throw new HttpError(404, 'Emergency contact not found');
    await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'trustee.removed',
      details: { email: rows[0].email }, ip: req.ip });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---- Trustee side: people who trust me ------------------------------------

router.get('/invitations', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT t.id, t.can_report, t.can_confirm, t.created_at, o.name AS owner_name
         FROM trustees t JOIN users o ON o.id = t.owner_id
        WHERE t.email = $1 AND t.status = 'invited' ORDER BY t.created_at`,
      [req.user.email]
    );
    res.json({ invitations: rows.map((r) => ({ id: r.id, ownerName: r.owner_name, canReport: r.can_report, canConfirm: r.can_confirm, createdAt: r.created_at })) });
  } catch (err) {
    next(err);
  }
});

const answerInvitation = (accepted) => async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `UPDATE trustees SET status = $3, trustee_id = $4, updated_at = now()
        WHERE id = $1 AND email = $2 AND status = 'invited' RETURNING owner_id`,
      [req.params.id, req.user.email, accepted ? 'accepted' : 'declined', accepted ? req.user.id : null]
    );
    if (!rows[0]) throw new HttpError(404, 'Invitation not found');
    await audit.record({ userId: rows[0].owner_id, actorId: req.user.id, action: `trustee.${accepted ? 'accepted' : 'declined'}`, ip: req.ip });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
};

router.post('/invitations/:id/accept', param('id').isUUID(), validate, answerInvitation(true));
router.post('/invitations/:id/decline', param('id').isUUID(), validate, answerInvitation(false));

// Only the owner's name, email and the state of a run are shared with a trustee;
// checklist, contacts and messages stay private.
router.get('/people', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT t.can_report, t.can_confirm, o.id AS owner_id, o.name, o.email, a.*
         FROM trustees t
         JOIN users o ON o.id = t.owner_id
         LEFT JOIN activations a ON a.user_id = o.id AND a.status = ANY($2)
        WHERE t.trustee_id = $1 AND t.status = 'accepted'
        ORDER BY o.name`,
      [req.user.id, activations.OPEN_STATUSES]
    );
    res.json({
      people: rows.map((r) => ({
        id: r.owner_id,
        name: r.name,
        email: r.email,
        canReport: r.can_report,
        canConfirm: r.can_confirm,
        currentRun: r.id ? {
          id: r.id,
          source: r.source,
          status: r.status,
          checkInDeadline: r.check_in_deadline,
          dispatchAt: r.dispatch_at,
          reportedByMe: r.reported_by === req.user.id,
        } : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

async function loadLink(req, permission) {
  const { rows } = await db.query(
    `SELECT t.*, row_to_json(o.*) AS owner FROM trustees t JOIN users o ON o.id = t.owner_id
      WHERE t.owner_id = $1 AND t.trustee_id = $2 AND t.status = 'accepted'`,
    [req.params.ownerId, req.user.id]
  );
  const link = rows[0];
  if (!link) throw new HttpError(404, 'Person not found');
  if (permission && !link[permission]) throw new HttpError(403, 'You do not have permission to do that for this person');
  return link;
}

router.post('/people/:ownerId/report',
  reportLimiter,
  param('ownerId').isUUID(),
  body('password').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      const link = await loadLink(req, 'can_report');
      await verifyPassword(req);
      const activation = await activations.reportByTrustee(link.owner, req.user, req.ip);
      res.status(201).json({ activation: serializeActivation(activation) });
    } catch (err) {
      next(err);
    }
  });

router.post('/people/:ownerId/activations/:id/confirm',
  reportLimiter,
  param('ownerId').isUUID(),
  param('id').isUUID(),
  body('password').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      await loadLink(req, 'can_confirm');
      await verifyPassword(req);
      const { rows } = await db.query('SELECT user_id FROM activations WHERE id = $1', [req.params.id]);
      if (!rows[0] || rows[0].user_id !== req.params.ownerId) throw new HttpError(404, 'Activation not found');
      const activation = await activations.confirmRun(req.params.id, req.user, 'trustee', req.ip);
      res.json({ activation: serializeActivation(activation) });
    } catch (err) {
      next(err);
    }
  });

// A trustee can take back a report they made, e.g. if it was a mistake.
router.post('/people/:ownerId/activations/:id/withdraw',
  param('ownerId').isUUID(),
  param('id').isUUID(),
  body('password').isString().notEmpty(),
  validate,
  async (req, res, next) => {
    try {
      await loadLink(req, null);
      await verifyPassword(req);
      const { rows } = await db.query('SELECT * FROM activations WHERE id = $1 AND user_id = $2', [req.params.id, req.params.ownerId]);
      if (!rows[0] || rows[0].reported_by !== req.user.id) throw new HttpError(404, 'You have no report to withdraw here');
      const activation = await activations.cancel(rows[0], req.user, 'withdrawn_by_trustee', req.ip);
      res.json({ activation: serializeActivation(activation) });
    } catch (err) {
      next(err);
    }
  });

module.exports = router;
