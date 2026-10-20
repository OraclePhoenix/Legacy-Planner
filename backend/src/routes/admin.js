const express = require('express');
const { param, query } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const activations = require('../services/activations');
const { serializeActivation } = require('./serializers');
const HttpError = require('../utils/httpError');

const router = express.Router();

router.get('/activations',
  query('status').optional().isIn(['checkin_pending', 'awaiting_admin', 'scheduled', 'dispatching', 'sent', 'failed', 'cancelled']),
  validate,
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT a.*, u.name AS user_name, u.email AS user_email FROM activations a JOIN users u ON u.id = a.user_id
          WHERE ($1::text IS NULL OR a.status = $1) ORDER BY a.created_at DESC LIMIT 100`,
        [req.query.status || null]
      );
      res.json({ activations: rows.map(serializeActivation) });
    } catch (err) {
      next(err);
    }
  });

router.post('/activations/:id/confirm', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const activation = await activations.confirmByAdmin(req.params.id, req.user, req.ip);
    res.json({ activation: serializeActivation(activation) });
  } catch (err) {
    next(err);
  }
});

router.post('/activations/:id/reject', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM activations WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'Activation not found');
    const activation = await activations.cancel(rows[0], req.user, 'rejected_by_admin', req.ip);
    res.json({ activation: serializeActivation(activation) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
