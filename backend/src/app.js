const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const db = require('./db');
const { authenticate, requireRole } = require('./middleware/auth');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: config.frontendUrl }));
  app.use(express.json({ limit: '100kb' }));
  if (config.env !== 'test') app.use(morgan('combined'));
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', async (req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api/auth', require('./routes/auth').router);
  app.use('/api/me', authenticate, require('./routes/me'));
  app.use('/api/checklist', authenticate, require('./routes/checklist'));
  app.use('/api/contacts', authenticate, require('./routes/contacts'));
  app.use('/api/templates', authenticate, require('./routes/templates'));
  app.use('/api/activations', authenticate, require('./routes/activations'));
  app.use('/api/audit', authenticate, require('./routes/audit'));
  app.use('/api/admin', authenticate, requireRole('admin'), require('./routes/admin'));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
