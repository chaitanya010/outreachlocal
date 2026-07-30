'use strict';

const { getClient } = require('./supabaseClient');
const { isLikelyRealBusiness } = require('../filters/institutionalFilter');
const logger = require('../utils/logger');

const TABLE = 'leads';
const LOGS_TABLE = 'outreach_logs';

// ─── Leads ────────────────────────────────────────────────────────────────────

async function upsertLeads(leads) {
  if (!leads.length) return { inserted: 0, errors: 0 };

  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .upsert(leads, { onConflict: 'place_id', ignoreDuplicates: false })
    .select('id');

  if (error) {
    logger.error('Supabase upsert failed', { message: error.message });
    throw error;
  }

  logger.info(`Upserted ${data.length} leads`);
  return { inserted: data.length, errors: 0 };
}

/**
 * Query leads with optional filters.
 */
async function getLeads({ noWebsite, city, outreachStatus, limit = 100, offset = 0 } = {}) {
  const db = getClient();

  let query = db
    .from(TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (noWebsite === true) query = query.eq('has_website', false);
  if (city) query = query.ilike('city', `%${city}%`);
  if (outreachStatus) query = query.eq('outreach_status', outreachStatus);

  const { data, error, count } = await query;

  if (error) {
    logger.error('Supabase query failed', { message: error.message });
    throw error;
  }

  return { leads: data, total: count };
}

/**
 * Update enrichment fields for a single lead.
 */
async function updateEnrichment(placeId, fields) {
  const db = getClient();
  const { error } = await db
    .from(TABLE)
    .update({ ...fields, enriched_at: new Date().toISOString() })
    .eq('place_id', placeId);

  if (error) {
    logger.error('Enrichment update failed', { placeId, message: error.message });
    throw error;
  }
}

/**
 * Mark a lead as contacted and stamp the channels used.
 *
 * @param {string}   placeId
 * @param {object[]} logs    array of { channel, status } from outreachLead()
 */
async function markOutreachSent(placeId, logs) {
  const db = getClient();
  const now = new Date().toISOString();

  const updates = { outreach_status: 'contacted', last_outreach_at: now };

  for (const log of logs) {
    if (log.status !== 'sent') continue;
    if (log.channel === 'sms')       updates.sms_sent_at       = now;
    if (log.channel === 'whatsapp')  updates.whatsapp_sent_at  = now;
    if (log.channel === 'email')     updates.email_sent_at     = now;
    if (log.channel === 'call')      updates.call_attempted_at = now;
  }

  const successChannels = logs.filter((l) => l.status === 'sent').map((l) => l.channel);
  if (successChannels.length) updates.outreach_channel = successChannels.join(',');

  const { error } = await db.from(TABLE).update(updates).eq('place_id', placeId);

  if (error) {
    logger.error('markOutreachSent failed', { placeId, message: error.message });
    throw error;
  }
}

// ─── Outreach Logs ────────────────────────────────────────────────────────────

/**
 * Insert one row into outreach_logs.
 *
 * @param {object} entry
 * @param {string} entry.leadId
 * @param {string} entry.placeId
 * @param {string} entry.channel
 * @param {string} entry.status
 * @param {string} [entry.message]
 * @param {string} [entry.error]
 * @param {string} [entry.provider_id]
 */
async function logOutreach({ leadId, placeId, channel, status, message, error, provider_id, stage }) {
  const db = getClient();
  const { error: dbErr } = await db.from(LOGS_TABLE).insert({
    lead_id: leadId,
    place_id: placeId,
    channel,
    status,
    message,
    error: error || null,
    provider_id: provider_id || null,
    stage: stage || null,
  });

  if (dbErr) {
    logger.error('logOutreach insert failed', { message: dbErr.message });
    throw dbErr;
  }
}

/**
 * Query outreach logs with optional filters.
 */
async function getOutreachLogs({ placeId, channel, status, limit = 100, offset = 0 } = {}) {
  const db = getClient();

  let query = db
    .from(LOGS_TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (placeId)  query = query.eq('place_id', placeId);
  if (channel)  query = query.eq('channel', channel);
  if (status)   query = query.eq('status', status);

  const { data, error, count } = await query;

  if (error) {
    logger.error('getOutreachLogs failed', { message: error.message });
    throw error;
  }

  return { logs: data, total: count };
}

/**
 * No-website leads that still have no email — candidates for the free
 * website/social-profile scraper (and Hunter/Apollo fallback) run by
 * enrichmentService, so they become eligible for the email sequence.
 */
async function getLeadsMissingEmail(limit = 50) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('has_website', false)
    .is('email', null)
    .is('enriched_at', null)
    .order('prospect_score', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('getLeadsMissingEmail failed', { message: error.message });
    throw error;
  }
  return data || [];
}

/**
 * No-website leads with neither an email nor a social_url on file — i.e.
 * nothing at all for the scraper to work with. Candidates for a targeted
 * Place Details re-fetch (see POST /leads/backfill-web-presence) to recover
 * whatever web presence they have.
 */
async function getLeadsMissingWebPresence(limit = 50) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('has_website', false)
    .is('email', null)
    .is('social_url', null)
    .order('prospect_score', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('getLeadsMissingWebPresence failed', { message: error.message });
    throw error;
  }
  return data || [];
}

/**
 * Update website/has_website/social_url fields directly (no enriched_at
 * stamp — this isn't an enrichment attempt, it's recovering data that should
 * have been captured on first discovery).
 */
async function updateWebPresence(placeId, fields) {
  const db = getClient();
  const { error } = await db.from(TABLE).update(fields).eq('place_id', placeId);
  if (error) {
    logger.error('updateWebPresence failed', { placeId, message: error.message });
    throw error;
  }
}

// ─── Email Sequence ───────────────────────────────────────────────────────────

/**
 * Stage offsets in days since email_first_sent_at. Kept here (rather than only
 * in emailSequence.js) so the "is this lead due" filter can be expressed as a
 * single SQL query instead of pulling every lead into JS to check.
 */
const STAGE_OFFSET_DAYS = { 2: 3, 3: 7, 4: 14 };

/**
 * Find leads due for their next email-sequence stage: never contacted
 * (email_stage=0), or on an active stage whose next offset has elapsed.
 * Not replied, not stopped, has an email, no website (the outreach target).
 */
async function getEmailSequenceCandidates(limit = 20) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .not('email', 'is', null)
    .eq('email_stopped', false)
    .eq('email_replied', false)
    .eq('has_website', false)
    .order('prospect_score', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(500); // pull a working set, then filter stage-due in JS below

  if (error) {
    logger.error('getEmailSequenceCandidates query failed', { message: error.message });
    throw error;
  }

  const now = Date.now();
  const due = (data || [])
    .filter((lead) => lead.email_stage === 0 || lead.email_stage < 4)
    .filter(isLikelyRealBusiness) // screen out government/institutional false positives
    .map((lead) => {
      const stage = lead.email_stage || 0;
      if (stage === 0) return { lead, nextStage: 1, isNew: true };
      const nextStage = stage + 1;
      const offsetDays = STAGE_OFFSET_DAYS[nextStage];
      if (!offsetDays) return null; // stage 4 already sent, nothing further
      if (!lead.email_first_sent_at) return null;
      const daysSince = (now - Date.parse(lead.email_first_sent_at)) / 86400000;
      if (daysSince < offsetDays) return null;
      return { lead, nextStage, isNew: false };
    })
    .filter(Boolean)
    // Follow-ups are time-sensitive obligations to leads who already had contact;
    // prioritize them over fresh intros, which have no such deadline.
    .sort((a, b) => Number(a.isNew) - Number(b.isNew));

  return due.slice(0, limit);
}

/**
 * Record a successful stage send: bump email_stage, stamp last_sent, and
 * stamp first_sent on the very first (stage 1) send.
 */
async function recordEmailStageSent(placeId, stage) {
  const db = getClient();
  const now = new Date().toISOString();
  const updates = { email_stage: stage, email_last_sent_at: now };
  if (stage === 1) updates.email_first_sent_at = now;

  const { error } = await db.from(TABLE).update(updates).eq('place_id', placeId);
  if (error) {
    logger.error('recordEmailStageSent failed', { placeId, message: error.message });
    throw error;
  }
}

/**
 * Flip email_replied or email_stopped for a lead by place_id.
 */
async function setEmailFlag(placeId, flag) {
  if (flag !== 'replied' && flag !== 'stopped') throw new Error(`Invalid flag: ${flag}`);
  const db = getClient();
  const column = flag === 'replied' ? 'email_replied' : 'email_stopped';
  const { error } = await db.from(TABLE).update({ [column]: true }).eq('place_id', placeId);
  if (error) {
    logger.error('setEmailFlag failed', { placeId, flag, message: error.message });
    throw error;
  }
  return true;
}

/**
 * Set email_stopped=true for every lead sharing the given email address
 * (used by the public /unsubscribe endpoint).
 */
async function stopEmailByAddress(email) {
  const db = getClient();
  const { error } = await db.from(TABLE).update({ email_stopped: true }).eq('email', email);
  if (error) {
    logger.error('stopEmailByAddress failed', { email, message: error.message });
    throw error;
  }
  return true;
}

/**
 * How many email-sequence sends have happened today (for the daily cap).
 */
async function countEmailSendsToday() {
  const db = getClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count, error } = await db
    .from(LOGS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .not('stage', 'is', null)
    .gte('created_at', startOfDay.toISOString());

  if (error) {
    logger.error('countEmailSendsToday failed', { message: error.message });
    throw error;
  }
  return count || 0;
}

/**
 * How many brand-new (stage 1) intro sends have happened today — the daily
 * "10 new businesses" cap is tracked separately from follow-up volume.
 */
async function countNewLeadEmailsSentToday() {
  const db = getClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count, error } = await db
    .from(LOGS_TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('channel', 'email')
    .eq('stage', 1)
    .gte('created_at', startOfDay.toISOString());

  if (error) {
    logger.error('countNewLeadEmailsSentToday failed', { message: error.message });
    throw error;
  }
  return count || 0;
}

/**
 * Timestamp of the most recent email-sequence send, for the min-gap check.
 */
async function getLastEmailSendTime() {
  const db = getClient();
  const { data, error } = await db
    .from(LOGS_TABLE)
    .select('created_at')
    .eq('channel', 'email')
    .not('stage', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.error('getLastEmailSendTime failed', { message: error.message });
    throw error;
  }
  return data && data.length ? data[0].created_at : null;
}

/**
 * Stage counts + reply/stop counts + sent-today, for the stats endpoint.
 */
async function getEmailSequenceStats() {
  const db = getClient();

  const [stageCounts, sentToday] = await Promise.all([
    (async () => {
      const { data, error } = await db.from(TABLE).select('email_stage, email_replied, email_stopped');
      if (error) throw error;
      const stats = { stage0: 0, stage1: 0, stage2: 0, stage3: 0, stage4: 0, replied: 0, stopped: 0 };
      for (const row of data || []) {
        stats[`stage${row.email_stage || 0}`] = (stats[`stage${row.email_stage || 0}`] || 0) + 1;
        if (row.email_replied) stats.replied++;
        if (row.email_stopped) stats.stopped++;
      }
      return stats;
    })(),
    countEmailSendsToday(),
  ]);

  return { ...stageCounts, sentToday };
}

module.exports = {
  upsertLeads,
  getLeads,
  updateEnrichment,
  markOutreachSent,
  logOutreach,
  getOutreachLogs,
  getLeadsMissingEmail,
  getLeadsMissingWebPresence,
  updateWebPresence,
  getEmailSequenceCandidates,
  recordEmailStageSent,
  setEmailFlag,
  stopEmailByAddress,
  countEmailSendsToday,
  countNewLeadEmailsSentToday,
  getLastEmailSendTime,
  getEmailSequenceStats,
};
