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
 * Only checks raw connectivity (DB reachable, each pool mailbox authenticates
 * over IMAP) -- deliberately not application-level heuristics like "no emails
 * sent today," which have too many legitimate explanations (daily cap, no
 * due candidates, off-hours) to be a reliable signal without a lot more
 * tuning than a first pass warrants.
 */

const cron = require('node-cron');
const { ImapFlow } = require('imapflow');
const { getClient } = require('../db/supabaseClient');
const { notifyOwner } = require('../utils/notify');
const logger = require('../utils/logger');

const TICK_HOURS = parseInt(process.env.HEALTHCHECK_TICK_HOURS || '3', 10);
const IMAP_HOST = process.env.EMAIL_IMAP_HOST;
const IMAP_PORT = parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);

function parseSenderPool() {
  const raw = process.env.EMAIL_SENDER_POOL || process.env.SES_FROM_EMAIL || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseImapPasswords(pool) {
  const raw = (process.env.EMAIL_IMAP_PASSWORDS || '').split(',').map((s) => s.trim());
  return pool.map((_, i) => raw[i] || null);
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
 * waiting for the cron schedule.
 */
async function runChecks() {
  const problems = [];

  const dbProblem = await checkDatabase();
  if (dbProblem) problems.push(dbProblem);

  const pool = parseSenderPool();
  const passwords = parseImapPasswords(pool);
  const mailboxResults = await Promise.all(pool.map((addr, i) => checkMailbox(addr, passwords[i])));
  problems.push(...mailboxResults.filter(Boolean));

  return problems;
}

let wasHealthy = true;

async function tick() {
  const problems = await runChecks();

  if (problems.length) {
    logger.error('Health check: problems found', { problems });
    await notifyOwner(
      'OutreachLocal: health check failed',
      `The following problems were found:\n\n${problems.map((p) => `- ${p}`).join('\n')}`
    );
    wasHealthy = false;
    return;
  }

  logger.info('Health check: all clear');
  if (!wasHealthy) {
    await notifyOwner('OutreachLocal: recovered', 'All checks (database, all mailboxes) are passing again.');
  }
  wasHealthy = true;
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

module.exports = { start, stop, tick, runChecks };
