'use strict';

/**
 * Runs all discovery sources for a (niche, city) pair in parallel and
 * merges the results into one raw candidate pool. A source failing (bad
 * API key, network error, rate limit) never blocks the others — each
 * source already catches its own errors and returns [].
 */

const googlePlacesSource = require('./googlePlacesSource');
const yelpSource = require('./yelpSource');
const bestOfCitySource = require('./bestOfCitySource');
const logger = require('../../utils/logger');

async function discoverCandidates(niche, city) {
  const results = await Promise.allSettled([
    googlePlacesSource.discover(niche, city),
    yelpSource.discover(niche, city),
    bestOfCitySource.discover(niche, city),
  ]);

  const candidates = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      candidates.push(...result.value);
    } else {
      logger.warn('discovery source failed', { niche, city, message: result.reason?.message });
    }
  }
  return candidates;
}

module.exports = { discoverCandidates };
