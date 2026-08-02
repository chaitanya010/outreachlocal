'use strict';

/**
 * Internal daily scheduler for the discovery pipeline — mirrors
 * emailCron.js's pattern (one node-cron task, runs once/day). Timed an hour
 * before the email enrich tick so the day's ~10 new leads already have
 * emails found by the time the send window opens; emailCron's own
 * enrichTick still runs as a backstop for anything discovery missed.
 */

const cron = require('node-cron');
const { runDailyDiscovery } = require('./discoveryPipeline');
const { notifyOnRecurringFailure, resetFailureStreak } = require('../utils/notify');
const logger = require('../utils/logger');

const BUSINESS_HOUR_START = parseInt(process.env.EMAIL_BUSINESS_HOUR_START || '9', 10);
const TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York';

let discoveryTask = null;

async function tick() {
  try {
    const result = await runDailyDiscovery();
    logger.info('Discovery cron tick complete', result);

    // A run that actually searched but stored nothing usually means an API
    // key expired/hit quota, or filtering got too aggressive -- silent
    // either way (no exception thrown), so nothing else would catch it.
    if (result.pairs > 0 && result.stored === 0) {
      await notifyOnRecurringFailure(
        'discovery_zero_yield',
        'OutreachLocal: discovery found 0 new leads',
        `Today's run searched ${result.pairs} (niche, city) pairs, found ${result.rawCandidates} raw candidates, but stored 0 new leads. Could mean an API key expired/hit quota, or dedup/filtering is too aggressive.\n\nFull summary: ${JSON.stringify(result)}`
      );
    } else if (result.stored > 0) {
      resetFailureStreak('discovery_zero_yield');
    }
  } catch (err) {
    logger.error('Discovery cron tick failed', { message: err.message });
    await notifyOnRecurringFailure('discovery_cron_crash', 'OutreachLocal: discovery cron crashed', err.message);
    return;
  }
  resetFailureStreak('discovery_cron_crash');
}

function start() {
  if (discoveryTask) return discoveryTask; // already running

  // 1.5 hours before the send window opens, so there's headroom for
  // discovery + enrichment before emailCron's enrich tick (30 min before open).
  const hour = BUSINESS_HOUR_START >= 2 ? BUSINESS_HOUR_START - 2 : 23;
  const expr = `0 ${hour} * * 1-5`;
  discoveryTask = cron.schedule(expr, tick, { timezone: TIMEZONE });
  logger.info('Discovery cron started', { expr, timezone: TIMEZONE });
  return discoveryTask;
}

function stop() {
  if (discoveryTask) {
    discoveryTask.stop();
    discoveryTask = null;
  }
}

module.exports = { start, stop, tick };
