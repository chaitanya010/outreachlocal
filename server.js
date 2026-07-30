require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate } = require('./src/config');
const leadsRouter = require('./src/routes/leads');
const enrichmentRouter = require('./src/routes/enrichment');
const outreachRouter = require('./src/routes/outreach');
const emailSequenceRouter = require('./src/routes/emailSequence');
const discoveryRouter = require('./src/routes/discovery');
const logger = require('./src/utils/logger');

// Validate env on startup
try {
  validate();
} catch (err) {
  logger.error(err.message);
  process.exit(1);
}

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// Rate limit all routes — 60 requests per minute per IP
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down.' },
  })
);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/', leadsRouter);
app.use('/', enrichmentRouter);
app.use('/', outreachRouter);
app.use('/', emailSequenceRouter);
app.use('/', discoveryRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { message: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start (only when run directly, not when required by tests) ──────────────

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`OutreachLocal server running on port ${PORT}`);
  });

  if (process.env.ENABLE_EMAIL_CRON !== 'false') {
    require('./src/jobs/emailCron').start();
  }

  if (process.env.ENABLE_DISCOVERY_CRON !== 'false') {
    require('./src/jobs/discoveryCron').start();
  }
}

module.exports = app; // exported for tests
