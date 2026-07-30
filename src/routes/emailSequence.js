'use strict';

const { Router } = require('express');
const emailSequence = require('../services/emailSequence');
const { stopEmailByAddress } = require('../db/leadsRepository');
const { verifyUnsubToken } = require('../utils/unsubscribe');
const logger = require('../utils/logger');

const router = Router();

// ─── Auth helpers (mirrors FootWord's outreach-core.js isAdmin/isCron) ───────

const isAdmin = (req) =>
  !!process.env.ADMIN_USER &&
  !!process.env.ADMIN_PASS &&
  req.headers['x-admin-user'] === process.env.ADMIN_USER &&
  req.headers['x-admin-pass'] === process.env.ADMIN_PASS;

const isCron = (req) =>
  !!process.env.CRON_SECRET &&
  req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

// ─── POST /outreach/email/run ─────────────────────────────────────────────────
/**
 * Cron/admin: run one drip cycle (sends at most one email).
 * ?dry=1 -> report what would be picked, no send, no writes.
 */
router.post('/outreach/email/run', async (req, res) => {
  if (!isAdmin(req) && !isCron(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    if (String(req.query.dry || '') === '1') {
      const candidate = await emailSequence.peekNextCandidate();
      return res.json({
        ok: true,
        dryRun: true,
        candidate: candidate
          ? { place_id: candidate.lead.place_id, name: candidate.lead.name, email: candidate.lead.email, nextStage: candidate.nextStage }
          : null,
      });
    }

    const result = await emailSequence.runOnce();
    return res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Email sequence run failed', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /outreach/email/:place_id/replied ───────────────────────────────────
router.post('/outreach/email/:place_id/replied', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    await emailSequence.markReplied(req.params.place_id);
    return res.json({ ok: true, place_id: req.params.place_id, replied: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /outreach/email/:place_id/stop ──────────────────────────────────────
router.post('/outreach/email/:place_id/stop', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    await emailSequence.markStopped(req.params.place_id);
    return res.json({ ok: true, place_id: req.params.place_id, stopped: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /outreach/email/queue ─────────────────────────────────────────────────
router.get('/outreach/email/queue', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const { getEmailSequenceCandidates } = require('../db/leadsRepository');
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const due = await getEmailSequenceCandidates(limit);
    return res.json({
      ok: true,
      count: due.length,
      queue: due.map((c) => ({ place_id: c.lead.place_id, name: c.lead.name, email: c.lead.email, nextStage: c.nextStage })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /outreach/email/stats ─────────────────────────────────────────────────
router.get('/outreach/email/stats', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'unauthorized' });
  try {
    const stats = await emailSequence.getEmailSequenceStats();
    return res.json({ ok: true, stats });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /unsubscribe ──────────────────────────────────────────────────────────
/**
 * Public. ?e=<email>&t=<hmac token from unsubscribe.js>
 */
router.get('/unsubscribe', async (req, res) => {
  const email = String(req.query.e || '');
  const token = String(req.query.t || '');

  if (!verifyUnsubToken(email, token)) {
    return res.status(400).type('text/plain').send('Invalid or expired unsubscribe link.');
  }

  try {
    await stopEmailByAddress(email);
    return res.type('text/plain').send(`${email} has been unsubscribed and will not receive further emails.`);
  } catch (err) {
    logger.error('Unsubscribe failed', { email, message: err.message });
    return res.status(500).type('text/plain').send('Something went wrong processing your request.');
  }
});

module.exports = router;
