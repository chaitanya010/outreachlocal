'use strict';

const { getClient } = require('./supabaseClient');

/**
 * Raw email send/failure log rows for the last N days, oldest first.
 * Aggregation happens in the route layer so this stays a single simple query.
 */
async function getEmailLogs(daysBack = 14) {
  const db = getClient();
  const since = new Date();
  since.setDate(since.getDate() - daysBack);

  const { data, error } = await db
    .from('outreach_logs')
    .select('created_at, status, sender, stage')
    .eq('channel', 'email')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data;
}

module.exports = { getEmailLogs };
