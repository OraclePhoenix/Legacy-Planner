const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');
const { body, param } = require('express-validator');
const db = require('../db');
const validate = require('../middleware/validate');
const audit = require('../services/audit');
const { serializeContact } = require('./serializers');
const { encrypt } = require('../utils/crypto');
const { normalizePhone } = require('../utils/phone');
const HttpError = require('../utils/httpError');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });
const MAX_IMPORT_ROWS = 1000;

const contactRules = (optional) => {
  const o = (chain) => (optional ? chain.optional() : chain);
  return [
    o(body('name')).trim().isLength({ min: 1, max: 100 }),
    o(body('phone')).isString(),
    body('relationship').optional({ values: 'null' }).trim().isLength({ max: 100 }),
    body('priority').optional().isInt({ min: 1, max: 3 }).toInt(),
  ];
};

function requirePhone(raw) {
  const phone = normalizePhone(raw);
  if (!phone) throw new HttpError(422, 'Enter a valid phone number, e.g. +15551234567');
  return phone;
}

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM contacts WHERE user_id = $1 ORDER BY priority, created_at', [req.user.id]);
    const contacts = rows.map(serializeContact).sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    res.json({ contacts });
  } catch (err) {
    next(err);
  }
});

router.get('/export', async (req, res, next) => {
  try {
    const { rows } = await db.query('SELECT * FROM contacts WHERE user_id = $1 ORDER BY priority, created_at', [req.user.id]);
    const csv = stringify(rows.map(serializeContact).map((c) => [c.name, c.phone, c.relationship || '', c.priority]), {
      header: true, columns: ['name', 'phone', 'relationship', 'priority'],
    });
    await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'contacts.exported', details: { count: rows.length }, ip: req.ip });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

router.post('/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new HttpError(422, 'Attach a CSV file in the "file" field');
    let records;
    try {
      records = parse(req.file.buffer, { columns: (h) => h.map((c) => c.trim().toLowerCase()), skip_empty_lines: true, trim: true, bom: true });
    } catch (err) {
      throw new HttpError(422, `Could not read CSV: ${err.message}`);
    }
    if (records.length > MAX_IMPORT_ROWS) throw new HttpError(422, `CSV has more than ${MAX_IMPORT_ROWS} rows`);

    const errors = [];
    const valid = [];
    records.forEach((r, i) => {
      const row = i + 2; // header is row 1
      const phone = normalizePhone(r.phone);
      const priority = r.priority ? parseInt(r.priority, 10) : 2;
      if (!r.name) errors.push({ row, message: 'Missing name' });
      else if (!phone) errors.push({ row, message: `Invalid phone number "${r.phone || ''}"` });
      else if (![1, 2, 3].includes(priority)) errors.push({ row, message: 'Priority must be 1, 2 or 3' });
      else valid.push({ name: r.name.slice(0, 100), phone, relationship: (r.relationship || '').slice(0, 100) || null, priority });
    });

    await db.withTransaction(async (client) => {
      for (const c of valid) {
        await client.query(
          'INSERT INTO contacts (user_id, name_enc, phone_enc, relationship, priority) VALUES ($1, $2, $3, $4, $5)',
          [req.user.id, encrypt(c.name), encrypt(c.phone), c.relationship, c.priority]
        );
      }
      await audit.record({ userId: req.user.id, actorId: req.user.id, action: 'contacts.imported',
        details: { imported: valid.length, rejected: errors.length }, ip: req.ip }, client);
    });
    res.json({ imported: valid.length, errors });
  } catch (err) {
    next(err);
  }
});

router.post('/', contactRules(false), validate, async (req, res, next) => {
  try {
    const phone = requirePhone(req.body.phone);
    const { rows } = await db.query(
      'INSERT INTO contacts (user_id, name_enc, phone_enc, relationship, priority) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, encrypt(req.body.name), encrypt(phone), req.body.relationship || null, req.body.priority || 2]
    );
    res.status(201).json({ contact: serializeContact(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', param('id').isUUID(), contactRules(true), validate, async (req, res, next) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name_enc = encrypt(req.body.name);
    if (req.body.phone !== undefined) updates.phone_enc = encrypt(requirePhone(req.body.phone));
    if (req.body.relationship !== undefined) updates.relationship = req.body.relationship || null;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    const keys = Object.keys(updates);
    if (keys.length === 0) throw new HttpError(422, 'Nothing to update');
    const sets = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const { rows } = await db.query(
      `UPDATE contacts SET ${sets}, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id, ...keys.map((k) => updates[k])]
    );
    if (!rows[0]) throw new HttpError(404, 'Contact not found');
    res.json({ contact: serializeContact(rows[0]) });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', param('id').isUUID(), validate, async (req, res, next) => {
  try {
    const { rowCount } = await db.query('DELETE FROM contacts WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    if (!rowCount) throw new HttpError(404, 'Contact not found');
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
