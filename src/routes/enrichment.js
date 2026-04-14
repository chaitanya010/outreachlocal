const { Router } = require('express');
const { getLeads, updateEnrichment } = require('../db/leadsRepository');
const { enrichBatch } = require('../services/enrichmentService');
const logger = require('../utils/logger');

const router = Router();

/**
 * POST /enrich
 *
 * Enrich unenriched no-website leads for a city (or all cities if omitted).
 * Body: { city?: string, limit?: number }
 */
router.post('/enrich', async (req, res) => {
  const { city, limit = 50 } = req.body;

  try {
    const { leads } = await getLeads({
      noWebsite: true,
      city: city || undefined,
      limit: Math.min(parseInt(limit, 10) || 50, 200),
    });

    const { enriched, skipped } = await enrichBatch(leads, updateEnrichment);

    return res.status(200).json({ success: true, enriched, skipped });
  } catch (err) {
    logger.error('Enrichment route error', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
