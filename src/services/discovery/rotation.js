'use strict';

/**
 * Picks today's (niche, city) search pairs, avoiding anything searched in
 * the last 180 days (per search_history). Random sampling over the full
 * niche x city cross product rather than a fixed rotation index, so the
 * pipeline self-heals if a run is skipped or the process restarts.
 */

const { NICHES } = require('./nicheLibrary');
const { CITIES } = require('./locationLibrary');
const { getRecentSearchHistory, recordSearchHistory } = require('../../db/leadsRepository');
const logger = require('../../utils/logger');

const COOLDOWN_DAYS = 180;

/** Fisher-Yates shuffle, in place. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * @param {number} count how many distinct (niche, city) pairs to pick
 * @returns {Promise<Array<{ niche: string, city: string, state: string }>>}
 */
async function pickTodayPairs(count) {
  const recentlyUsed = await getRecentSearchHistory(COOLDOWN_DAYS);

  // Build the full niche x city pool, drop anything on cooldown, shuffle,
  // take the first `count` -- deterministic single pass instead of random
  // retries (which degrade badly as the pool gets mostly-excluded).
  const eligible = [];
  for (const niche of NICHES) {
    for (const location of CITIES) {
      const key = `${niche.label}|${location.city}`;
      if (recentlyUsed.has(key)) continue;
      eligible.push({ niche: niche.label, city: location.city, state: location.state });
    }
  }

  const picked = shuffle(eligible).slice(0, count);

  if (picked.length < count) {
    logger.warn('rotation: fewer fresh (niche, city) pairs available than requested', {
      requested: count,
      picked: picked.length,
    });
  }

  return picked;
}

/** Record the pairs actually used today, so they're excluded going forward. */
async function recordUsedPairs(pairs) {
  if (!pairs.length) return;
  await recordSearchHistory(pairs);
}

module.exports = { pickTodayPairs, recordUsedPairs, COOLDOWN_DAYS };
