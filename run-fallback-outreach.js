#!/usr/bin/env node
'use strict';

/**
 * Independent execution path for the cold-email sequence, run by the
 * "Outreach Fallback" GitHub Actions workflow (.github/workflows/
 * outreach-fallback.yml) directly against Supabase + AWS SES -- no Railway
 * involved at all. Same core module as the Railway app (emailSequence.js),
 * so there is exactly one implementation of candidate selection, sender
 * rotation, stage progression, and dedup; this is just a second place that
 * calls it. Cross-worker duplicate-send safety comes from the atomic
 * per-lead claim in leadsRepository.claimLeadForStage(), not from this
 * script -- it's safe for this to run on its own schedule regardless of
 * whether Railway is up, down, or mid-deploy at that exact moment.
 *
 * Needs only: SUPABASE_URL, SUPABASE_SERVICE_KEY, AWS_REGION,
 * AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, SES_FROM_EMAIL, OPENAI_API_KEY,
 * EMAIL_SENDER_POOL/EMAIL_SENDER_NAMES, and the SERVER_URL/CRON_SECRET pair
 * (used only to build the correct unsubscribe link -- must match the real
 * production URL so those links actually work). Deliberately does NOT
 * import server.js/src/config's validate() -- that requires
 * GOOGLE_PLACES_API_KEY and other envs this job has no business needing.
 */

require('dotenv').config();

const emailSequence = require('./src/services/emailSequence');
const { recordHealthSuccess } = require('./src/db/leadsRepository');
const { notifyOnRecurringFailure, resetFailureStreak } = require('./src/utils/notify');
const logger = require('./src/utils/logger');

const WORKER_ID = 'github-fallback';

async function main() {
  try {
    const result = await emailSequence.runOnce({ workerId: WORKER_ID });
    logger.info('Fallback outreach run', result);
    await resetFailureStreak('fallback_run');
    await recordHealthSuccess(`scheduler:${WORKER_ID}`);
    process.exitCode = 0;
  } catch (err) {
    logger.error('Fallback outreach run failed', { message: err.message });
    await notifyOnRecurringFailure('fallback_run', 'OutreachLocal: fallback scheduler run crashed', err.message);
    process.exitCode = 1;
  }
}

main();
