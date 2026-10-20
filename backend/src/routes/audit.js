const express = require('express');
const { query } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');

const router = express.Router();

router.get('/',
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  validate,
  async (req, res, next) => {
    try {
      const page = req.query.page || 1;
      const limit = req.query.limit || 25;
      const [{ rows }, { rows: [{ total }] }] = await Promise.all([
        db.query(
          `SELECT l.id, l.action, l.details, l.created_at, l.actor_id, a.name AS actor_name
             FROM audit_logs l LEFT JOIN users a ON a.id = l.actor_id
            WHERE l.user_id = $1 ORDER BY l.created_at DESC, l.id DESC LIMIT $2 OFFSET $3`,
          [req.user.id, limit, (page - 1) * limit]
        ),
        db.query('SELECT count(*)::int AS total FROM audit_logs WHERE user_id = $1', [req.user.id]),
      ]);
      res.json({ entries: rows, page, limit, total });
    } catch (err) {
      next(err);
    }
  });

module.exports = router;
