'use strict';

/**
 * Owner heads-up notifications (booking link sent, reply needs personal
 * follow-up) -- thin wrapper around the existing SES sendEmail(). No-ops
 * (logs, doesn't throw) when NOTIFY_EMAIL is unset, so it's safe by default
 * anywhere that hasn't configured it -- never blocks the caller's own flow.
 */

const { sendEmail } = require('../services/emailService');
const { recordHealthFailure, recordHealthSuccess } = require('../db/leadsRepository');
const logger = require('../utils/logger');

/**
 * @param {string} subject
 * @param {string} body  plain text
 */
async function notifyOwner(subject, body) {
  const to = process.env.NOTIFY_EMAIL;
  if (!to) return;

  try {
    await sendEmail({ to, subject, text: body });
  } catch (err) {
    logger.error('notifyOwner: send failed', { message: err.message });
  }
}

/**
 * Notify on a recurring failure without spamming: fires on the FIRST
 * occurrence of a given `key` (fast signal), then again only every `everyNth`
 * occurrence after that, until resetFailureStreak(key) is called on success.
 * A sustained outage across many cron ticks produces a handful of emails
 * instead of one per tick.
 *
 * The streak count is persisted in Supabase (system_health, component
 * `failure:<key>`), not kept in process memory -- a Railway restart/redeploy,
 * or the fact that the GitHub-Actions fallback runner is a brand-new process
 * on every single invocation, must not silently reset an in-progress alert
 * streak or make a real sustained outage look like a fresh first failure
 * forever.
 */
async function notifyOnRecurringFailure(key, subject, body, everyNth = 5) {
  // Best-effort, like notifyOwner's own swallowed sendEmail errors above --
  // this fires from inside other functions' error-handling paths (a failed
  // send, a crashed cron tick), so a failure writing/reading the persisted
  // streak (e.g. Supabase itself being the thing that's down) must never
  // throw and mask or crash whatever original error the caller was already
  // handling. Falls back to always alerting if the count can't be read, on
  // the theory that an unthrottled alert beats a silently swallowed one.
  let count = 1;
  try {
    count = await recordHealthFailure(`failure:${key}`, body);
  } catch (err) {
    logger.error('notifyOnRecurringFailure: could not persist failure streak', { key, message: err.message });
  }
  if (count === 1 || count % everyNth === 0) {
    await notifyOwner(subject, `${body}\n\n(failure #${count} for this issue since it started)`);
  }
}

/** Call on success to clear a key's failure streak so the next failure notifies immediately again. */
async function resetFailureStreak(key) {
  try {
    await recordHealthSuccess(`failure:${key}`);
  } catch (err) {
    logger.error('resetFailureStreak: could not persist reset', { key, message: err.message });
  }
}

module.exports = { notifyOwner, notifyOnRecurringFailure, resetFailureStreak };
