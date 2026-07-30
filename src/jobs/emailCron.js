'use strict';

/**
 * Internal daily scheduler for the email sequence engine — runs inside this
 * process (no external cron/service needed) so "10 new businesses/day" and
 * follow-ups happen automatically every day the server is up.
 *
 * Ticks every EMAIL_TICK_MINUTES (default 30) during US business hours,
 * Mon-Fri, in CRON_TIMEZONE. Each tick calls emailSequence.runOnce(), which
 * sends at most one email and self-throttles via the daily cap + min-gap
 * jitter already built into the engine — so ~8 business hours / 30min ticks
 * naturally spreads the day's ~10 new intros (plus any due follow-ups)
 * across the day instead of firing them all at once.
 */

const cron = require('node-cron');
const emailSequence = require('../services/emailSequence');
const { getLeadsMissingEmail, updateEnrichment } = require('../db/leadsRepository');
const { enrichBatch } = require('../services/enrichmentService');
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
    const result = await emailSequence.runOnce();
    if (result.sent) {
      logger.info('Email cron tick: sent', result);
    } else {
      logger.info('Email cron tick: no-op', result);
    }
  } catch (err) {
    logger.error('Email cron tick failed', { message: err.message });
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
  } catch (err) {
    logger.error('Email cron enrich tick failed', { message: err.message });
  }
}

function start() {
  if (sendTask) return sendTask; // already running

  const sendExpr = `*/${TICK_MINUTES} ${BUSINESS_HOUR_START}-${BUSINESS_HOUR_END} * * 1-5`;
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
