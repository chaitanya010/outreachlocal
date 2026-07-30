'use strict';

/**
 * The daily discovery funnel: ~100 raw candidates across several
 * (niche, city) pairs -> dedupe -> institutional filter -> site-quality
 * scoring -> email/decision-maker enrichment -> rank -> top 10 stored.
 * Replaces the old single-Places-call runPipeline for the automated daily
 * run (runPipeline itself is untouched, still used by the manual
 * /generate-leads endpoint).
 */

const { pickTodayPairs, recordUsedPairs } = require('../services/discovery/rotation');
const { discoverCandidates } = require('../services/discovery');
const { dedupeCandidates, normalizeNameCity } = require('../services/discovery/dedupe');
const { getNicheByLabel } = require('../services/discovery/nicheLibrary');
const { annotateWebsiteStatus } = require('../filters/websiteFilter');
const { isLikelyRealBusiness } = require('../filters/institutionalFilter');
const { fetchAndAnalyze } = require('../services/websiteAnalyzer');
const { crawlForContact, discoverContactViaWebSearch } = require('../services/websiteEmailScraper');
const { scoreLeadForDiscovery } = require('../services/leadScorer');
const { buildPersonalizationSentence } = require('../services/personalizationEngine');
const { upsertLeads, getExistingLeadIdentifiers } = require('../db/leadsRepository');
const sleep = require('../utils/sleep');
const logger = require('../utils/logger');

const PAIRS_PER_RUN = parseInt(process.env.DISCOVERY_PAIRS_PER_RUN || '8', 10);
const SCORE_BUFFER = parseInt(process.env.DISCOVERY_SCORE_BUFFER || '25', 10); // candidates carried into email enrichment
const TOP_N = parseInt(process.env.DISCOVERY_TOP_N || '10', 10);

/**
 * @returns {Promise<{ pairs: number, rawCandidates: number, deduped: number, scored: number, emailed: number, stored: number }>}
 */
async function runDailyDiscovery() {
  const pairs = await pickTodayPairs(PAIRS_PER_RUN);
  if (!pairs.length) {
    logger.warn('discoveryPipeline: no fresh (niche, city) pairs available today');
    return { pairs: 0, rawCandidates: 0, deduped: 0, scored: 0, emailed: 0, stored: 0 };
  }

  // Stage 1: discovery across sources, one pair at a time (politeness — this
  // runs once/day, no need to hammer Google/Yelp/Serper concurrently).
  const rawCandidates = [];
  for (const pair of pairs) {
    const found = await discoverCandidates(pair.niche, pair.city);
    rawCandidates.push(...found);
    await sleep(300);
  }
  logger.info('discoveryPipeline: raw candidates found', { pairs: pairs.length, rawCandidates: rawCandidates.length });

  // Stage 2: normalize website vs social_url (same rule as the manual pipeline)
  annotateWebsiteStatus(rawCandidates);

  // Stage 3: dedupe against each other and against existing leads
  const existing = await getExistingLeadIdentifiers();
  const deduped = dedupeCandidates(rawCandidates, existing).filter(isLikelyRealBusiness);
  logger.info('discoveryPipeline: after dedupe + institutional filter', { deduped: deduped.length });

  // Stage 4: site-quality analysis + scoring (fetch each candidate's site once)
  const scored = [];
  for (const candidate of deduped) {
    const niche = getNicheByLabel(candidate.business_type);
    let siteSignals = null;
    let baseHtml = null;

    if (candidate.website) {
      const analysis = await fetchAndAnalyze(candidate.website);
      if (analysis) {
        siteSignals = analysis.signals;
        baseHtml = analysis.html;
      }
    }

    const intel = scoreLeadForDiscovery(candidate, niche, siteSignals);
    scored.push({ ...candidate, ...intel, _baseHtml: baseHtml });
  }

  scored.sort((a, b) => b.ai_opportunity_score - a.ai_opportunity_score);
  const topCandidates = scored.slice(0, SCORE_BUFFER);
  logger.info('discoveryPipeline: scored, taking top candidates for email enrichment', { scored: scored.length, buffer: topCandidates.length });

  // Stage 5: email/decision-maker discovery, richest source first
  const withEmail = [];
  for (const candidate of topCandidates) {
    const contactUrl = candidate.website || candidate.social_url;
    let contact = null;

    if (contactUrl) {
      contact = await crawlForContact(contactUrl, { baseHtml: candidate._baseHtml });
    } else {
      contact = await discoverContactViaWebSearch(candidate.name, candidate.city);
    }

    if (contact?.email) {
      withEmail.push({
        ...candidate,
        email: contact.email,
        email_confidence: contact.confidence,
        decision_maker_name: contact.decisionMakerName,
        decision_maker_role: contact.decisionMakerRole,
      });
    }

    await sleep(200);
  }
  logger.info('discoveryPipeline: email enrichment done', { attempted: topCandidates.length, found: withEmail.length });

  // Stage 6: final institutional re-check (now that emails are known) + rank + top N
  const finalPool = withEmail.filter(isLikelyRealBusiness).sort((a, b) => b.ai_opportunity_score - a.ai_opportunity_score);
  const top = finalPool.slice(0, TOP_N);

  // Stage 7: personalization sentence + store
  const toStore = top.map((lead) => {
    const { _baseHtml, ...clean } = lead;
    return {
      ...clean,
      place_id: clean.place_id || `generated:${normalizeNameCity(clean.name, clean.city)}`,
      personalization_sentence: buildPersonalizationSentence(clean, clean),
      enriched_at: new Date().toISOString(),
    };
  });

  const { inserted } = await upsertLeads(toStore);

  // Stage 8: record today's (niche, city) pairs so they're excluded for the cooldown window
  await recordUsedPairs(pairs);

  const summary = {
    pairs: pairs.length,
    rawCandidates: rawCandidates.length,
    deduped: deduped.length,
    scored: scored.length,
    emailed: withEmail.length,
    stored: inserted,
  };
  logger.info('discoveryPipeline: run complete', summary);
  return summary;
}

module.exports = { runDailyDiscovery };
