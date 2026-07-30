/**
 * enrichmentService.js
 *
 * Attempts to find email / domain for a lead using configured API providers.
 * Falls back gracefully if a provider is not configured or returns no data.
 *
 * Providers supported:
 *   1. Hunter.io  — domain search by business name + city
 *   2. Apollo.io  — organization search by name
 *
 * Only API calls are used — no scraping.
 */

const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { config } = require('../config');
const { scrapeEmailFromUrl, searchWebForEmail } = require('./websiteEmailScraper');
const sleep = require('../utils/sleep');
const logger = require('../utils/logger');

// ─── Shared axios instance ────────────────────────────────────────────────────

const client = axios.create({ timeout: 8_000 });

axiosRetry(client, {
  retries: 2,
  retryDelay: (n) => n * 1000,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    err.response?.status === 429,
});

// ─── Hunter.io ────────────────────────────────────────────────────────────────

/**
 * Try to find a domain for the business using Hunter's domain search.
 * Returns { email, domain } or null.
 *
 * @param {string} name    business name
 * @param {string} city
 */
async function enrichWithHunter(name, city) {
  if (!config.enrichment.hunterKey) return null;

  try {
    // Hunter domain-search requires a domain; use their company-search instead
    const { data } = await client.get('https://api.hunter.io/v2/domain-search', {
      params: {
        company: name,
        api_key: config.enrichment.hunterKey,
        limit: 1,
      },
    });

    const domain = data?.data?.domain;
    const email = data?.data?.emails?.[0]?.value || null;

    if (!domain) return null;

    logger.debug('Hunter enrichment hit', { name, domain, email });
    return { domain, email };
  } catch (err) {
    logger.warn('Hunter enrichment failed', { name, message: err.message });
    return null;
  }
}

// ─── Apollo.io ────────────────────────────────────────────────────────────────

/**
 * Try to find an organization match via Apollo's organization search.
 * Returns { email, domain } or null.
 *
 * @param {string} name
 * @param {string} city
 */
async function enrichWithApollo(name, city) {
  if (!config.enrichment.apolloKey) return null;

  try {
    const { data } = await client.post(
      'https://api.apollo.io/v1/organizations/search',
      {
        q_organization_name: name,
        q_organization_locations: [city],
        per_page: 1,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': config.enrichment.apolloKey,
        },
      }
    );

    const org = data?.organizations?.[0];
    if (!org) return null;

    const domain = org.primary_domain || org.website_url || null;
    const email = org.contact_emails?.[0] || null;

    logger.debug('Apollo enrichment hit', { name, domain, email });
    return { domain, email };
  } catch (err) {
    logger.warn('Apollo enrichment failed', { name, message: err.message });
    return null;
  }
}

// ─── Main enrichment function ─────────────────────────────────────────────────

/**
 * Enrich a single lead. Tries, in order (each free before falling further):
 *   1. Scrape the lead's known website/social_url, if any
 *   2. No known URL at all -> search the open web for the business and
 *      scrape the top results (no Google Places call, no search API key)
 *   3. Hunter, then Apollo (only if those API keys are configured)
 * Returns enrichment data or null if nothing found.
 *
 * @param {{ name: string, city: string, website?: string, social_url?: string }} lead
 * @returns {Promise<{ email: string|null, domain: string|null }|null>}
 */
async function enrichLead(lead) {
  const scrapeUrl = lead.website || lead.social_url;
  if (scrapeUrl) {
    const email = await scrapeEmailFromUrl(scrapeUrl);
    if (email) {
      logger.debug('Scrape enrichment hit', { name: lead.name, email });
      return { email, domain: null };
    }
  } else {
    const email = await searchWebForEmail(lead.name, lead.city);
    if (email) {
      logger.debug('Web-search enrichment hit', { name: lead.name, email });
      return { email, domain: null };
    }
  }

  const result =
    (await enrichWithHunter(lead.name, lead.city)) ||
    (await enrichWithApollo(lead.name, lead.city));

  return result;
}

/**
 * Enrich a batch of leads and update the DB for each one that gets a result.
 *
 * @param {object[]} leads
 * @param {Function} updateFn  (placeId, fields) => Promise<void>  (from leadsRepository)
 * @returns {Promise<{ enriched: number, skipped: number }>}
 */
async function enrichBatch(leads, updateFn) {
  let enriched = 0;
  let skipped = 0;

  for (const lead of leads) {
    // Don't re-enrich if already done
    if (lead.enriched_at) {
      skipped++;
      continue;
    }

    const result = await enrichLead(lead);
    if (result) {
      await updateFn(lead.place_id, result);
      enriched++;
    } else {
      skipped++;
    }

    // Be polite to DuckDuckGo / target sites between leads — this runs once/day
    // in the background, there's no rush.
    await sleep(500);
  }

  logger.info('Batch enrichment complete', { enriched, skipped });
  return { enriched, skipped };
}

module.exports = { enrichLead, enrichBatch };
