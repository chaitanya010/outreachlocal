'use strict';

/**
 * Periodic self-check for the pieces that can go silently wrong without ever
 * throwing an exception anywhere -- a dead Supabase connection or a broken
 * mailbox password don't crash the process, they just make every dependent
 * job quietly no-op or log-and-skip forever (see the per-mailbox try/catch in
 * replyWatcher.js, for example). Nobody watches the log files, so this
 * surfaces that class of failure proactively via notifyOwner instead of
 * waiting for you to notice leads have stopped moving.
 *
 * Checks, in order:
 *  1. Database reachable.
 *  2. Each pool mailbox authenticates over IMAP.
 *  3. Both scheduling paths (Railway's internal cron, the GitHub-Actions
 *     fallback runner) have heartbeated recently -- only meaningful, and
 *     only checked, during business hours, since neither is expected to run
 *     off-hours/weekends. Only alerts if BOTH are stale -- one path being
 *     temporarily down while the other covers it is the failover working as
 *     designed, not an incident.
 *  4. Eligible leads are sitting due, but nothing has actually sent in a
 *     while, during business hours -- the one application-level heuristic
 *     here, deliberately narrow (gated to business hours + requires an
 *     actual due candidate) so it doesn't false-positive on a legitimately
 *     quiet daily cap / min-gap window.
 *
 * Every check's pass/fail state and consecutive-failure streak is persisted
 * in Supabase (system_health, via notify.js's notifyOnRecurringFailure /
 * resetFailureStreak) rather than kept in process memory, so a Railway
 * restart can't reset an alert streak mid-outage or forget an outage was
 * ever detected.
 */

const cron = require('node-cron');
const { ImapFlow } = require('imapflow');
const { getClient } = require('../db/supabaseClient');
const { getHealthComponents, getLastEmailSendTime } = require('../db/leadsRepository');
const { peekNextCandidate } = require('../services/emailSequence');
const { notifyOnRecurringFailure, resetFailureStreak } = require('../utils/notify');
const logger = require('../utils/logger');

const TICK_HOURS = parseInt(process.env.HEALTHCHECK_TICK_HOURS || '3', 10);
const IMAP_HOST = process.env.EMAIL_IMAP_HOST;
const IMAP_PORT = parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);
const TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York';
const BUSINESS_HOUR_START = parseInt(process.env.EMAIL_BUSINESS_HOUR_START || '9', 10);
const BUSINESS_HOUR_END = parseInt(process.env.EMAIL_BUSINESS_HOUR_END || '17', 10);

// Generous vs. the 30min tick interval either scheduler runs on -- this is a
// "has scheduling stopped entirely" signal, not a tight SLA, so it should
// tolerate a slow run or a couple of missed ticks without false-alarming.
const SCHEDULER_STALE_MINUTES = parseInt(process.env.HEALTHCHECK_SCHEDULER_STALE_MINUTES || '90', 10);
const OUTREACH_STALLED_MINUTES = parseInt(process.env.HEALTHCHECK_OUTREACH_STALLED_MINUTES || '180', 10);

function parseSenderPool() {
  const raw = process.env.EMAIL_SENDER_POOL || process.env.SES_FROM_EMAIL || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseImapPasswords(pool) {
  const raw = (process.env.EMAIL_IMAP_PASSWORDS || '').split(',').map((s) => s.trim());
  return pool.map((_, i) => raw[i] || null);
}

/** Weekday + hour check in CRON_TIMEZONE, mirroring emailCron.js's own send window. */
function withinBusinessHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday').value;
  const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  return isWeekday && hour >= BUSINESS_HOUR_START && hour < BUSINESS_HOUR_END;
}

function minutesSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 60000;
}

async function checkDatabase() {
  try {
    const { error } = await getClient().from('leads').select('id').limit(1);
    if (error) throw error;
    return null;
  } catch (err) {
    return `Supabase unreachable: ${err.message}`;
  }
}

async function checkMailbox(address, password) {
  if (!IMAP_HOST || !password) return `${address}: no IMAP password configured`;
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: address, pass: password },
    logger: false,
  });
  try {
    await client.connect();
    return null;
  } catch (err) {
    return `${address}: ${err.message}`;
  } finally {
    try {
      await client.logout();
    } catch (_err) {
      // connection never opened or already closed, nothing to do
    }
  }
}

/**
 * Runs every check and returns the list of problem descriptions (empty if
 * everything's healthy). Exported directly so it can be exercised without
 * waiting for the cron schedule. Does NOT itself alert -- see tick(), which
 * layers per-component throttled alerting (notifyOnRecurringFailure) on top
 * so a sustained outage doesn't spam and a single missed check doesn't
 * either.
 */
async function runChecks(now = new Date()) {
  const problems = [];

  const dbProblem = await checkDatabase();
  if (dbProblem) problems.push(dbProblem);

  const pool = parseSenderPool();
  const passwords = parseImapPasswords(pool);
  const mailboxResults = await Promise.all(pool.map((addr, i) => checkMailbox(addr, passwords[i])));
  problems.push(...mailboxResults.filter(Boolean));

  if (withinBusinessHours(now)) {
    const heartbeats = await getHealthComponents(['scheduler:railway', 'scheduler:github-fallback']);
    const railwayStale = minutesSince(heartbeats['scheduler:railway']?.last_ok_at) > SCHEDULER_STALE_MINUTES;
    const fallbackStale = minutesSince(heartbeats['scheduler:github-fallback']?.last_ok_at) > SCHEDULER_STALE_MINUTES;
    if (railwayStale && fallbackStale) {
      problems.push(`Both scheduling paths appear stopped (no successful run in the last ${SCHEDULER_STALE_MINUTES}min)`);
    }

    const candidate = await peekNextCandidate();
    const lastSend = await getLastEmailSendTime();
    if (candidate && minutesSince(lastSend) > OUTREACH_STALLED_MINUTES) {
      problems.push(
        `Eligible leads are waiting (e.g. ${candidate.lead.place_id}) but nothing has sent in over ${OUTREACH_STALLED_MINUTES}min`
      );
    }
  }

  return problems;
}

async function tick(now = new Date()) {
  const dbProblem = await checkDatabase();
  if (dbProblem) await notifyOnRecurringFailure('health_database', 'OutreachLocal: database unreachable', dbProblem, 1);
  else await resetFailureStreak('health_database');

  const pool = parseSenderPool();
  const passwords = parseImapPasswords(pool);
  await Promise.all(
    pool.map(async (addr, i) => {
      const err = await checkMailbox(addr, passwords[i]);
      const key = `health_mailbox:${addr}`;
      if (err) await notifyOnRecurringFailure(key, `OutreachLocal: mailbox auth failing (${addr})`, err, 3);
      else await resetFailureStreak(key);
    })
  );

  if (!withinBusinessHours(now)) {
    logger.info('Health check: mailbox/database checks done (outside business hours, skipping scheduler/outreach checks)');
    return;
  }

  const heartbeats = await getHealthComponents(['scheduler:railway', 'scheduler:github-fallback']);
  const railwayStale = minutesSince(heartbeats['scheduler:railway']?.last_ok_at) > SCHEDULER_STALE_MINUTES;
  const fallbackStale = minutesSince(heartbeats['scheduler:github-fallback']?.last_ok_at) > SCHEDULER_STALE_MINUTES;
  if (railwayStale && fallbackStale) {
    await notifyOnRecurringFailure(
      'health_scheduler_stopped',
      'OutreachLocal: both scheduling paths appear stopped',
      `Neither Railway's internal cron nor the GitHub-Actions fallback runner has completed a run in the last ${SCHEDULER_STALE_MINUTES} minutes, during business hours.`,
      1
    );
  } else {
    await resetFailureStreak('health_scheduler_stopped');
  }

  const candidate = await peekNextCandidate();
  const lastSend = await getLastEmailSendTime();
  if (candidate && minutesSince(lastSend) > OUTREACH_STALLED_MINUTES) {
    await notifyOnRecurringFailure(
      'health_outreach_stalled',
      'OutreachLocal: eligible leads waiting but nothing sent recently',
      `${candidate.lead.name} (${candidate.lead.place_id}) is due for stage ${candidate.nextStage}, but no email has sent in over ${OUTREACH_STALLED_MINUTES} minutes during business hours.`,
      1
    );
  } else {
    await resetFailureStreak('health_outreach_stalled');
  }

  logger.info('Health check: tick complete');
}

let task = null;

function start() {
  if (task) return task;
  const expr = `0 */${TICK_HOURS} * * *`;
  task = cron.schedule(expr, tick);
  logger.info('Health check cron started', { expr });
  return task;
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { start, stop, tick, runChecks, withinBusinessHours };
