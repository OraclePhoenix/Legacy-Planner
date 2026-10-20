const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const { encrypt, decrypt } = require('../utils/crypto');
const HttpError = require('../utils/httpError');

const router = express.Router();

const rules = (optional) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('name')).trim().isLength({ min: 1, max: 100 }),
    o(body('body')).isString().isLength({ min: 1, max: 1600 }),
    body('contactIds').optional().isArray({ max: 500 }),
    body('contactIds.*').isUUID(),
  ];
};

async function load(userId, id) {
  const { rows } = await db.query(
    `SELECT t.*, COALESCE(array_agg(tr.contact_id) FILTER (WHERE tr.contact_id IS NOT NULL), '{}') AS contact_ids
       FROM message_templates t LEFT JOIN template_recipients tr ON tr.template_id = t.id
      WHERE t.user_id = $1 AND ($2::uuid IS NULL OR t.id = $2)
      GROUP BY t.id ORDER BY t.created_at`,
    [userId, id]
  );
  return rows.map((t) => ({ id: t.id, name: t.name, body: decrypt(t.body_enc), contactIds: t.contact_ids, createdAt: t.created_at, updatedAt: t.updated_at }));
}

async function setRecipients(client, userId, templateId, contactIds) {
  const unique = [...new Set(contactIds)];
  const { rows } = await client.query('SELECT id FROM contacts WHERE user_id = $1 AND id = ANY($2)', [userId, unique]);
  if (rows.length !== unique.length) throw new HttpError(422, 'One or more recipients are not your contacts');
  await client.query('DELETE FROM template_recipients WHERE template_id = $1', [templateId]);
  for (const contactId of unique) {
    await client.query('INSERT INTO template_recipients (template_id, contact_id) VALUES ($1, $2)', [templateId, contactId]);
  }
}

router.get('/', async (req, res, next) => {
  try {
    res.json({ templates: await load(req.user.id, null) });
  } catch (err) {
    next(err);
  }
});

router.post('/', rules(false), validate, async (req, res, next) => {
  try {
    const id = await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO message_templates (user_id, name, body_enc) VALUES ($1, $2, $3) RETURNING id',
        [req.user.id, req.body.name, encrypt(req.body.body)]
      );
      await setRecipients(client, req.user.id, rows[0].id, req.body.contactIds || []);
      return rows[0].id;
    });
    res.status(201).json({ template: (await load(req.user.id, id))[0] });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', param('id').isUUID(), rules(true), validate, async (req, res, next) => {
  try {
    await db.withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE message_templates SET name = COALESCE($3, name), body_enc = COALESCE($4, body_enc), updated_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING id`,
        [req.params.id, req.user.id, req.body.name ?? null, req.body.body !== undefined ? encrypt(req.body.body) : null]
      );
      if (!rows[0]) throw new HttpError(404, 'Message not found');
      if (req.body.contactIds) await setRecipients(client, req.user.id, req.params.id, req.body.contactIds);
    });
    res.json({ template: (await load(req.user.id, req.params.id))[0] });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM message_templates WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Message not found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
