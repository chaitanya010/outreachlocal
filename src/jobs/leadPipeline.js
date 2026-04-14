const { fetchLeads } = require('../services/googlePlacesService');
const { annotateWebsiteStatus, filterNoWebsite } = require('../filters/websiteFilter');
const { upsertLeads } = require('../db/leadsRepository');
const logger = require('../utils/logger');

const DEFAULT_TYPES = ['spa', 'massage', 'hair salon', 'med spa', 'clinic'];

/**
 * Full pipeline: fetch → filter → store.
 *
 * @param {string}   city
 * @param {string[]} [types]
 * @returns {Promise<{
 *   total: number,
 *   noWebsite: number,
 *   stored: number,
 *   city: string
 * }>}
 */
async function runPipeline(city, types = DEFAULT_TYPES) {
  logger.info('Pipeline started', { city, types });

  // Step 1 + 2: Fetch + normalize
  const raw = await fetchLeads(city, types);

  // Step 3: Annotate & filter
  const annotated = annotateWebsiteStatus(raw);
  const noWebsiteLeads = filterNoWebsite(annotated);

  logger.info(`Filter results`, {
    total: annotated.length,
    noWebsite: noWebsiteLeads.length,
    hasWebsite: annotated.length - noWebsiteLeads.length,
  });

  // Step 4: Store all leads (has_website flags set correctly)
  // We store everything so the DB is a full record, not just filtered view
  const { inserted } = await upsertLeads(annotated);

  const summary = {
    city,
    total: annotated.length,
    noWebsite: noWebsiteLeads.length,
    stored: inserted,
  };

  logger.info('Pipeline complete', summary);
  return summary;
}

module.exports = { runPipeline, DEFAULT_TYPES };
