'use strict';

/**
 * Yelp Fusion Business Search — an official, free-tier API (not scraping),
 * used as a second structured discovery source alongside Google Places.
 * Yelp's API doesn't return a business's own website (only its Yelp listing
 * URL), so every Yelp-sourced candidate starts as has_website=false and
 * relies on the pipeline's email/web-search step to find a real site.
 */

const axios = require('axios');
const { config } = require('../../config');
const logger = require('../../utils/logger');

const client = axios.create({ timeout: 8_000 });

async function discover(niche, city) {
  const apiKey = config.yelp.apiKey;
  if (!apiKey) return []; // degrades to Google-Places-only, same pattern as Serper

  try {
    const { data } = await client.get('https://api.yelp.com/v3/businesses/search', {
      headers: { Authorization: `Bearer ${apiKey}` },
      params: { term: niche, location: city, limit: 20 },
    });

    const businesses = data?.businesses || [];
    return businesses
      .filter((b) => !b.is_closed)
      .map((b) => ({
        place_id: `yelp:${b.id}`,
        name: b.name,
        city,
        address: [b.location?.address1, b.location?.city, b.location?.state].filter(Boolean).join(', '),
        phone: b.display_phone || b.phone || null,
        website: null,
        has_website: false,
        rating: b.rating ?? null,
        review_count: b.review_count ?? 0,
        has_booking: false,
        business_status: 'OPERATIONAL',
        business_type: niche,
        types: (b.categories || []).map((c) => c.alias),
        source: 'yelp',
      }));
  } catch (err) {
    logger.warn('yelpSource: search failed', { niche, city, message: err.message });
    return [];
  }
}

module.exports = { discover };
