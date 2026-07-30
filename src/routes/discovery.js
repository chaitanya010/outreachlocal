'use strict';

const { Router } = require('express');
const { runDailyDiscovery } = require('../jobs/discoveryPipeline');
const logger = require('../utils/logger');

const router = Router();

// Same auth pattern as src/routes/emailSequence.js
const isAdmin = (req) =>
  !!process.env.ADMIN_USER &&
  !!process.env.ADMIN_PASS &&
  req.headers['x-admin-user'] === process.env.ADMIN_USER &&
  req.headers['x-admin-pass'] === process.env.ADMIN_PASS;

const isCron = (req) =>
  !!process.env.CRON_SECRET &&
  req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

// ─── POST /leads/discover-daily ───────────────────────────────────────────────
/**
 * Cron/admin: run one full discovery pipeline pass (rotates niche/city pairs,
 * discovers ~100 candidates, dedupes, scores, enriches emails, stores top 10).
 * Callable by the internal node-cron (discoveryCron.js) or externally by the
 * GitHub Actions workflow, same redundant-trigger pattern as email sending.
 */
router.post('/leads/discover-daily', async (req, res) => {
  if (!isAdmin(req) && !isCron(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const result = await runDailyDiscovery();
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Discovery pipeline run failed', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
