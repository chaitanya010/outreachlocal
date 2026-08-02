'use strict';

/**
 * Owner heads-up notifications (booking link sent, reply needs personal
 * follow-up) -- thin wrapper around the existing SES sendEmail(). No-ops
 * (logs, doesn't throw) when NOTIFY_EMAIL is unset, so it's safe by default
 * anywhere that hasn't configured it -- never blocks the caller's own flow.
 */

const { sendEmail } = require('../services/emailService');
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

// In-memory per-key consecutive-failure counters (reset on process restart --
// same tradeoff healthCheck.js already makes with its wasHealthy flag).
const failureCounts = new Map();

/**
 * Notify on a recurring failure without spamming: fires on the FIRST
 * occurrence of a given `key` (fast signal), then again only every `everyNth`
 * occurrence after that, until resetFailureStreak(key) is called on success.
 * A sustained outage across many cron ticks produces a handful of emails
 * instead of one per tick.
 */
async function notifyOnRecurringFailure(key, subject, body, everyNth = 5) {
  const count = (failureCounts.get(key) || 0) + 1;
  failureCounts.set(key, count);
  if (count === 1 || count % everyNth === 0) {
    await notifyOwner(subject, `${body}\n\n(failure #${count} for this issue since it started)`);
  }
}

/** Call on success to clear a key's failure streak so the next failure notifies immediately again. */
function resetFailureStreak(key) {
  failureCounts.delete(key);
}

module.exports = { notifyOwner, notifyOnRecurringFailure, resetFailureStreak };
