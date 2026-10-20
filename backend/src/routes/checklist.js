const express = require('express');
const { body, param, query } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const { serializeItem } = require('./serializers');
const HttpError = require('../utils/httpError');

const router = express.Router();
const CATEGORIES = ['legal', 'financial', 'personal', 'medical', 'digital', 'other'];

const itemRules = (optional) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('title')).trim().isLength({ min: 1, max: 200 }),
    body('category').optional().isIn(CATEGORIES),
    body('status').optional().isIn(['pending', 'completed']),
    body('priority').optional().isIn(['low', 'medium', 'high']),
    body('dueDate').optional({ values: 'null' }).isISO8601(),
    body('notes').optional({ values: 'null' }).isString().isLength({ max: 5000 }),
  ];
};

router.get('/',
  query('category').optional().isIn(CATEGORIES),
  query('status').optional().isIn(['pending', 'completed']),
  validate,
  async (req, res, next) => {
    try {
      const { rows } = await db.query(
        `SELECT * FROM checklist_items WHERE user_id = $1
           AND ($2::text IS NULL OR category = $2) AND ($3::text IS NULL OR status = $3)
         ORDER BY status, due_date NULLS LAST, created_at`,
        [req.user.id, req.query.category || null, req.query.status || null]
      );
      res.json({ items: rows.map(serializeItem) });
    } catch (err) {
      next(err);
    }
  });

router.get('/summary', async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `SELECT category, count(*)::int AS total,
              count(*) FILTER (WHERE status = 'completed')::int AS completed
         FROM checklist_items WHERE user_id = $1 GROUP BY category ORDER BY category`,
      [req.user.id]
    );
    const total = rows.reduce((n, r) => n + r.total, 0);
    const completed = rows.reduce((n, r) => n + r.completed, 0);
    res.json({ total, completed, byCategory: rows });
  } catch (err) {
    next(err);
  }
});

router.post('/', itemRules(false), validate, async (req, res, next) => {
  try {
    const b = req.body;
    const status = b.status || 'pending';
    const { rows } = await db.query(
      `INSERT INTO checklist_items (user_id, title, category, status, priority, due_date, notes, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [req.user.id, b.title, b.category || 'personal', status, b.priority || 'medium',
        b.dueDate || null, b.notes || null, status === 'completed' ? new Date() : null]
    );
    res.status(201).json({ item: serializeItem(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', param('id').isUUID(), itemRules(true), validate, async (req, res, next) => {
  try {
    const map = { title: 'title', category: 'category', status: 'status', priority: 'priority', dueDate: 'due_date', notes: 'notes' };
    const updates = {};
    for (const [key, column] of Object.entries(map)) {
      if (req.body[key] !== undefined) updates[column] = req.body[key];
    }
    if (updates.status) updates.completed_at = updates.status === 'completed' ? new Date() : null;
    const keys = Object.keys(updates);
    if (keys.length === 0) throw new HttpError(422, 'Nothing to update');
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await db.query(
      `UPDATE checklist_items SET ${sets}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id, ...keys.map((k) => updates[k])]
    );
    if (!rows[0]) throw new HttpError(404, 'Item not found');
    res.json({ item: serializeItem(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM checklist_items WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Item not found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
