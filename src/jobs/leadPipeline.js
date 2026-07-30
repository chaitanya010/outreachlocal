const { fetchLeads } = require('../services/googlePlacesService');
const { annotateWebsiteStatus, filterNoWebsite } = require('../filters/websiteFilter');
const { upsertLeads } = require('../db/leadsRepository');
const { scoreLead } = require('../services/prospectScorer');
const logger = require('../utils/logger');

const DEFAULT_TYPES = [
  'barbershop', 'nail salon', 'lash studio', 'brow studio', 'tattoo studio',
  'hair transplant clinic', 'makeup studio', 'skincare center', 'tanning salon',
  'massage therapy', 'chiropractic clinic', 'physiotherapy', 'dental clinic',
  'veterinary clinic', 'weight loss clinic', 'wellness center', 'cryotherapy',
  'iv therapy clinic', 'mental health', 'occupational therapy',
];

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

  // Step 4: Score every lead for prospect quality
  const scored = annotated.map((lead) => {
    const { prospect_score, problems } = scoreLead(lead);
    return { ...lead, prospect_score, problems };
  });

  // Step 5: Store all leads with scores
  const { inserted } = await upsertLeads(scored);

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
