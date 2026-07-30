'use strict';

/**
 * Supplemental discovery via Serper.dev, standing in for the "local news /
 * award winners / best-of-city listings" sources from the spec. Genuinely
 * best-effort: for local-intent queries Serper sometimes returns a `places`
 * array (mirroring Google's local pack) alongside the regular organic
 * results. If that's present we get real structured candidates (name,
 * address, sometimes a website); if not, we return nothing rather than
 * fragile-scraping a listicle article to guess business names out of prose.
 * Not a primary source — no hit-rate guarantee, and pipeline results should
 * never depend on this returning anything.
 */

const { serperSearch } = require('../websiteEmailScraper');
const logger = require('../../utils/logger');

async function discover(niche, city) {
  try {
    const data = await serperSearch(`best ${niche} in ${city}`);
    const places = data?.places || [];

    return places
      .filter((p) => p.title)
      .map((p) => ({
        place_id: null,
        name: p.title,
        city,
        address: p.address || null,
        phone: p.phoneNumber || null,
        website: p.website || null,
        has_website: !!p.website,
        rating: p.rating ?? null,
        review_count: p.ratingCount ?? 0,
        has_booking: false,
        business_status: 'OPERATIONAL',
        business_type: niche,
        types: [],
        source: 'best_of_city',
      }));
  } catch (err) {
    logger.debug('bestOfCitySource: search failed', { niche, city, message: err.message });
    return [];
  }
}

module.exports = { discover };
