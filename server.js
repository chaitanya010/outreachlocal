require('dotenv').config();

const express = require('express');
const rateLimit = require('express-rate-limit');
const { validate } = require('./src/config');
const leadsRouter = require('./src/routes/leads');
const enrichmentRouter = require('./src/routes/enrichment');
const outreachRouter = require('./src/routes/outreach');
const emailSequenceRouter = require('./src/routes/emailSequence');
const discoveryRouter = require('./src/routes/discovery');
const sesWebhookRouter = require('./src/routes/sesWebhook');
const logger = require('./src/utils/logger');
const { notifyOwner } = require('./src/utils/notify');

// ─── Crash protection ─────────────────────────────────────────────────────────
// Node 15+ kills the whole process on any unhandled promise rejection by
// default -- without this, one unexpected error anywhere (a route handler, a
// library call inside a cron job) takes down leads/discovery/email/reply-
// watcher together, not just whatever failed. Every job's own tick() already
// catches its own errors (see emailCron.js, discoveryCron.js, replyWatcher.js)
// so in practice this is a safety net for anything those don't cover (route
// handlers, library internals) -- log it, alert the owner, and keep serving
// for a rejection; for a truly uncaught exception (process may be in a bad
// state), alert then exit so the process supervisor restarts it cleanly.
process.on('unhandledRejection', async (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Unhandled promise rejection', { message, stack });
  await notifyOwner('OutreachLocal: unhandled error', `${message}\n\n${stack || ''}`);
});

process.on('uncaughtException', async (err) => {
  logger.error('Uncaught exception -- process will exit', { message: err.message, stack: err.stack });
  await notifyOwner('OutreachLocal: server crashed, restarting', `${err.message}\n\n${err.stack || ''}`);
  process.exit(1);
});

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
app.use('/', sesWebhookRouter);

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

  if (process.env.ENABLE_REPLY_WATCHER_CRON !== 'false') {
    require('./src/jobs/replyWatcher').start();
  }

  if (process.env.ENABLE_HEALTHCHECK_CRON !== 'false') {
    require('./src/jobs/healthCheck').start();
  }
}

module.exports = app; // exported for tests
