'use strict';

/**
 * Thin wrapper around the existing googlePlacesService for a single
 * (niche, city) pair, tagging each result with its discovery source.
 */

const { fetchLeads } = require('../googlePlacesService');

async function discover(niche, city) {
  const leads = await fetchLeads(city, [niche]);
  return leads.map((l) => ({ ...l, source: 'google_places' }));
}

module.exports = { discover };
