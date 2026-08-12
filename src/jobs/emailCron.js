'use strict';

/**
 * Internal daily scheduler for the email sequence engine — runs inside this
 * process (no external cron/service needed) so "10 new businesses/day" and
 * follow-ups happen automatically every day the server is up.
 *
 * Ticks every EMAIL_TICK_MINUTES (default 30), around the clock, every day.
 * Used to be restricted to US business hours (9-17 CRON_TIMEZONE, Mon-Fri) —
 * but that window only ever overlaps a US lead's actual business hours; a
 * lead in Sydney was never reachable at all, since NY's 9am-5pm falls in the
 * middle of the Australian night. Now that leads span multiple countries
 * (see locationLibrary.js), the hour/weekday gate lives per-lead instead
 * (emailSequence.js's isWithinBusinessHours, via src/utils/timezone.js) —
 * this scheduler just needs to tick often enough that SOME tick lands inside
 * each country's own window. Each tick calls emailSequence.runOnce(), which
 * sends at most one email and self-throttles via the daily cap + min-gap
 * jitter already built into the engine, so the extra off-hour ticks
 * (relative to the old US-only window) just no-op cheaply rather than
 * over-sending.
 */

const cron = require('node-cron');
const emailSequence = require('../services/emailSequence');
const { getLeadsMissingEmail, updateEnrichment, recordHealthSuccess } = require('../db/leadsRepository');
const { enrichBatch } = require('../services/enrichmentService');
const { notifyOnRecurringFailure, resetFailureStreak } = require('../utils/notify');
const logger = require('../utils/logger');

const TICK_MINUTES = parseInt(process.env.EMAIL_TICK_MINUTES || '30', 10);
const BUSINESS_HOUR_START = parseInt(process.env.EMAIL_BUSINESS_HOUR_START || '9', 10);
const BUSINESS_HOUR_END = parseInt(process.env.EMAIL_BUSINESS_HOUR_END || '17', 10);
const ENRICH_BATCH_SIZE = parseInt(process.env.EMAIL_ENRICH_BATCH_SIZE || '50', 10);
const TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York';

let sendTask = null;
let enrichTask = null;

async function tick() {
  try {
    const result = await emailSequence.runOnce({ workerId: 'railway' });
    if (result.sent) {
      logger.info('Email cron tick: sent', result);
    } else {
      logger.info('Email cron tick: no-op', result);
    }
    await resetFailureStreak('email_cron_tick');
    // Heartbeat: "the scheduler executed this cycle", independent of whether
    // it actually sent anything -- a no-op tick (daily cap, min-gap, nothing
    // due) is normal and shouldn't look like an outage. Read by
    // healthCheck.js to detect a stopped scheduler even across restarts,
    // and by the GitHub-Actions fallback runner's own staleness logic isn't
    // needed since it heartbeats itself the same way (see
    // scripts/fallbackOutreachRun.js) under 'scheduler:github-fallback'.
    await recordHealthSuccess('scheduler:railway');
  } catch (err) {
    // runOnce() already catches send failures internally (see
    // emailSequence.js) -- reaching here means something more fundamental
    // broke (e.g. the candidates query itself), which is rarer and equally
    // worth knowing about fast.
    logger.error('Email cron tick failed', { message: err.message });
    await notifyOnRecurringFailure('email_cron_tick', 'OutreachLocal: email cron tick crashed', err.message);
  }
}

/**
 * Runs once/day before the send window: finds no-website leads missing an
 * email and tries to fill it in (free website/social scrape, then Hunter/
 * Apollo if configured) so they become eligible for the intro batch.
 */
async function enrichTick() {
  try {
    const leads = await getLeadsMissingEmail(ENRICH_BATCH_SIZE);
    if (!leads.length) {
      logger.info('Email cron enrich tick: nothing to enrich');
      return;
    }
    const result = await enrichBatch(leads, updateEnrichment);
    logger.info('Email cron enrich tick: done', { candidates: leads.length, ...result });
    await resetFailureStreak('email_cron_enrich');
  } catch (err) {
    logger.error('Email cron enrich tick failed', { message: err.message });
    await notifyOnRecurringFailure('email_cron_enrich', 'OutreachLocal: email enrich tick crashed', err.message);
  }
}

function start() {
  if (sendTask) return sendTask; // already running

  // No hour/weekday restriction here anymore -- runOnce() -> isWithinBusinessHours
  // gates each candidate by ITS OWN country's local business hours, so this
  // just needs to tick regularly around the clock to catch all of them.
  const sendExpr = `*/${TICK_MINUTES} * * * *`;
  sendTask = cron.schedule(sendExpr, tick, { timezone: TIMEZONE });
  logger.info('Email send cron started', { expr: sendExpr, timezone: TIMEZONE });

  // 30 minutes before the send window opens, so fresh emails are ready in
  // time for the first send tick.
  const enrichHour = BUSINESS_HOUR_START > 0 ? BUSINESS_HOUR_START - 1 : 23;
  const enrichExpr = `30 ${enrichHour} * * 1-5`;
  enrichTask = cron.schedule(enrichExpr, enrichTick, { timezone: TIMEZONE });
  logger.info('Email enrich cron started', { expr: enrichExpr, timezone: TIMEZONE });

  return sendTask;
}

function stop() {
  if (sendTask) {
    sendTask.stop();
    sendTask = null;
  }
  if (enrichTask) {
    enrichTask.stop();
    enrichTask = null;
  }
}

module.exports = { start, stop, tick, enrichTick };
