const { Router } = require('express');
const { runPipeline, DEFAULT_TYPES } = require('../jobs/leadPipeline');
const { getLeads } = require('../db/leadsRepository');
const logger = require('../utils/logger');

const router = Router();

// ─── POST /generate-leads ─────────────────────────────────────────────────────

/**
 * Trigger lead generation pipeline for a city.
 *
 * Body: { city: string, types?: string[] }
 */
router.post('/generate-leads', async (req, res) => {
  const { city, types } = req.body;

  if (!city || typeof city !== 'string' || !city.trim()) {
    return res.status(400).json({ error: 'city is required' });
  }

  const businessTypes = Array.isArray(types) && types.length ? types : DEFAULT_TYPES;

  try {
    const summary = await runPipeline(city.trim(), businessTypes);
    return res.status(200).json({ success: true, ...summary });
  } catch (err) {
    logger.error('Pipeline error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /leads ───────────────────────────────────────────────────────────────

/**
 * Query stored leads.
 *
 * Query params:
 *   noWebsite=true        only businesses without a website
 *   city=Miami            filter by city
 *   status=pending        filter by outreach_status
 *   limit=100             pagination
 *   offset=0
 */
router.get('/leads', async (req, res) => {
  const {
    noWebsite,
    city,
    status,
    limit = '100',
    offset = '0',
  } = req.query;

  const opts = {
    noWebsite: noWebsite === 'true',
    city: city || undefined,
    outreachStatus: status || undefined,
    limit: Math.min(parseInt(limit, 10) || 100, 500),
    offset: parseInt(offset, 10) || 0,
  };

  try {
    const { leads, total } = await getLeads(opts);
    return res.status(200).json({
      total,
      count: leads.length,
      offset: opts.offset,
      leads,
    });
  } catch (err) {
    logger.error('Get leads error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /dashboard ───────────────────────────────────────────────────────────

/**
 * Simple aggregate stats for a quick dashboard view.
 */
router.get('/dashboard', async (req, res) => {
  try {
    const [all, noWebsite, pending, contacted] = await Promise.all([
      getLeads({ limit: 1 }),
      getLeads({ noWebsite: true, limit: 1 }),
      getLeads({ outreachStatus: 'pending', limit: 1 }),
      getLeads({ outreachStatus: 'contacted', limit: 1 }),
    ]);

    return res.status(200).json({
      totalLeads: all.total,
      noWebsiteLeads: noWebsite.total,
      outreach: {
        pending: pending.total,
        contacted: contacted.total,
      },
    });
  } catch (err) {
    logger.error('Dashboard error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
