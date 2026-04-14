const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const { config } = require('../config');
const sleep = require('../utils/sleep');
const logger = require('../utils/logger');

// ─── Axios instance with retry ────────────────────────────────────────────────

const client = axios.create({
  baseURL: 'https://maps.googleapis.com/maps/api/place',
  timeout: 10_000,
});

axiosRetry(client, {
  retries: 3,
  retryDelay: (retryCount) => retryCount * 1000,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    err.response?.status === 429,
  onRetry: (count, err) =>
    logger.warn(`Places API retry #${count}`, { message: err.message }),
});

// ─── Supported business types ─────────────────────────────────────────────────

const BUSINESS_TYPE_MAP = {
  spa:       'spa',
  massage:   'beauty_salon',
  'hair salon': 'hair_care',
  'med spa': 'beauty_salon',
  clinic:    'doctor',
};

// ─── Text Search (handles pagination) ────────────────────────────────────────

/**
 * Fetch all Places results for a given query + city, across pages.
 * Google Text Search returns max 60 results (3 pages of 20).
 *
 * @param {string} query  e.g. "spa"
 * @param {string} city   e.g. "Miami, FL"
 * @returns {Promise<object[]>} raw place results
 */
async function textSearch(query, city) {
  const results = [];
  let pageToken = null;
  let page = 1;

  do {
    const params = {
      query: `${query} in ${city}`,
      key: config.google.apiKey,
      ...(pageToken && { pagetoken: pageToken }),
    };

    logger.debug(`Fetching Places page ${page}`, { query, city });

    const { data } = await client.get('/textsearch/json', { params });

    if (data.status === 'REQUEST_DENIED') {
      throw new Error(`Google Places API denied: ${data.error_message}`);
    }

    if (data.status === 'OVER_QUERY_LIMIT') {
      throw new Error('Google Places API quota exceeded.');
    }

    if (!['OK', 'ZERO_RESULTS'].includes(data.status)) {
      logger.warn(`Unexpected Places status: ${data.status}`);
      break;
    }

    results.push(...(data.results || []));

    pageToken = data.next_page_token || null;

    // Google requires a short delay before using next_page_token
    if (pageToken) {
      await sleep(config.pipeline.requestDelayMs || 2000);
    }

    page++;
  } while (pageToken && results.length < config.google.maxResults);

  logger.info(`Fetched ${results.length} raw results`, { query, city });
  return results;
}

// ─── Place Details (fetch website + phone if missing) ────────────────────────

/**
 * Fetch full place details for a single place_id.
 * Used to retrieve website / phone when not in text search results.
 *
 * @param {string} placeId
 * @returns {Promise<object>}
 */
async function getPlaceDetails(placeId) {
  const { data } = await client.get('/details/json', {
    params: {
      place_id: placeId,
      fields: 'name,formatted_address,formatted_phone_number,website,rating,types',
      key: config.google.apiKey,
    },
  });

  if (data.status !== 'OK') {
    logger.warn(`Place details failed for ${placeId}`, { status: data.status });
    return null;
  }

  return data.result;
}

// ─── Normalize ────────────────────────────────────────────────────────────────

/**
 * Map a raw Google Places result to our internal lead schema.
 *
 * @param {object} place  raw Google Places result
 * @param {string} city
 * @returns {object}
 */
function normalizeLead(place, city) {
  return {
    place_id: place.place_id,
    name: place.name,
    city,
    address: place.formatted_address || place.vicinity || null,
    phone: place.formatted_phone_number || place.international_phone_number || null,
    website: place.website || null,
    has_website: Boolean(place.website),
    rating: place.rating ?? null,
    types: place.types || [],
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Fetch and normalize all leads for a city + list of business types.
 *
 * @param {string}   city
 * @param {string[]} types  e.g. ["spa", "massage", "hair salon"]
 * @returns {Promise<object[]>} normalized leads
 */
async function fetchLeads(city, types) {
  const seen = new Set();
  const leads = [];

  for (const type of types) {
    const query = BUSINESS_TYPE_MAP[type] ? type : type; // use label as search term
    const raw = await textSearch(query, city);

    for (const place of raw) {
      if (seen.has(place.place_id)) continue;
      seen.add(place.place_id);

      // Text search doesn't always return website/phone — fetch details if needed
      let enriched = place;
      if (!place.website || !place.formatted_phone_number) {
        const details = await getPlaceDetails(place.place_id);
        if (details) enriched = { ...place, ...details };
        await sleep(100); // light delay between detail calls
      }

      leads.push(normalizeLead(enriched, city));
    }

    // Delay between type searches to avoid hammering quota
    await sleep(config.pipeline.requestDelayMs);
  }

  logger.info(`Total unique leads fetched: ${leads.length}`, { city });
  return leads;
}

module.exports = { fetchLeads, normalizeLead, getPlaceDetails };
