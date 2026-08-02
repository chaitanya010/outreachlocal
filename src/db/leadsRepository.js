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
 * @param {number} [entry.subjectVariant]  index (0-4) of the AI subject variant sent (email only)
 * @param {string} [entry.painPoint]       problem key cited as the observation (email only)
 * @param {string} [entry.sender]          which mailbox sent this (email only, sender rotation)
 */
async function logOutreach({ leadId, placeId, channel, status, message, error, provider_id, stage, subjectVariant, painPoint, sender }) {
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
    subject_variant: subjectVariant === undefined || subjectVariant === -1 ? null : subjectVariant,
    pain_point: painPoint || null,
    sender: sender || null,
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
// Stage 2 (the decoy resend) fires after 2 days rather than 3 -- the decoy
// is meant to get a fast reply, so a shorter gap makes sense than the
// original pain-point follow-up cadence.
const STAGE_OFFSET_DAYS = { 2: 2, 3: 7, 4: 14 };

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
 * Leads currently sitting in the decoy stage (1 or 2), not yet replied, not
 * stopped -- the pool replyWatcher.js checks incoming mail against. Scoped
 * to has_website=false and email_stopped/replied=false like the rest of the
 * sequence; NOT scoped to a single sender since the watcher already knows
 * which mailbox it's polling and passes that in separately.
 */
async function getDecoyStageLeadsBySenderAndEmail(sender, email) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('assigned_sender', sender)
    .eq('email', email)
    .eq('email_replied', false)
    .eq('email_stopped', false)
    .lte('email_stage', 2)
    .limit(1);

  if (error) {
    logger.error('getDecoyStageLeadsBySenderAndEmail failed', { sender, email, message: error.message });
    throw error;
  }
  return data && data.length ? data[0] : null;
}

/**
 * The Message-ID SES returned for a lead's most recent decoy send (stage 1
 * or 2) -- used to thread the pivot reply (In-Reply-To/References) so it
 * shows up in the same conversation instead of as a new, disconnected email.
 */
async function getLastDecoyMessageId(placeId) {
  const db = getClient();
  const { data, error } = await db
    .from(LOGS_TABLE)
    .select('provider_id')
    .eq('place_id', placeId)
    .eq('channel', 'email')
    .lte('stage', 2)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) {
    logger.error('getLastDecoyMessageId failed', { placeId, message: error.message });
    throw error;
  }
  return data && data.length ? data[0].provider_id : null;
}

/**
 * Marks the reply-triggered pivot/reveal email as sent for a lead, so a
 * second/third reply from the same lead doesn't trigger it again.
 */
async function markPivotSent(placeId) {
  const db = getClient();
  const { error } = await db
    .from(TABLE)
    .update({ email_pivot_sent: true, last_reply_at: new Date().toISOString() })
    .eq('place_id', placeId);
  if (error) {
    logger.error('markPivotSent failed', { placeId, message: error.message });
    throw error;
  }
}

/**
 * Leads that already replied to the pivot/reveal email (email_pivot_sent) but
 * haven't been sent the booking link yet -- the pool replyWatcher.js checks a
 * mailbox's incoming mail against once the decoy-stage lookup misses. Scoped
 * to email_stopped=false like the rest of the sequence; NOT scoped to a
 * single sender for the same reason as getDecoyStageLeadsBySenderAndEmail.
 */
async function getPostPivotAwaitingBookingLeads(sender, email) {
  const db = getClient();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('assigned_sender', sender)
    .eq('email', email)
    .eq('email_pivot_sent', true)
    .eq('booking_sent', false)
    .eq('email_stopped', false)
    .limit(1);

  if (error) {
    logger.error('getPostPivotAwaitingBookingLeads failed', { sender, email, message: error.message });
    throw error;
  }
  return data && data.length ? data[0] : null;
}

/**
 * Marks the booking-link email as sent for a lead, so a second/third reply
 * from the same lead doesn't trigger it again.
 */
async function markBookingSent(placeId) {
  const db = getClient();
  const { error } = await db
    .from(TABLE)
    .update({ booking_sent: true })
    .eq('place_id', placeId);
  if (error) {
    logger.error('markBookingSent failed', { placeId, message: error.message });
    throw error;
  }
}

/**
 * Whether we've already processed a given inbound reply (by its Message-ID
 * header) -- dedup guard for replyWatcher.js so re-polling the same mailbox
 * never double-processes a reply. Deliberately does NOT rely on IMAP \Seen
 * flags, since these are real mailboxes someone may also check manually --
 * marking messages read as a side effect of polling would be surprising.
 */
async function hasProcessedInboundMessage(messageId) {
  const db = getClient();
  const { data, error } = await db
    .from(LOGS_TABLE)
    .select('id')
    .eq('channel', 'email_reply')
    .eq('provider_id', messageId)
    .limit(1);
  if (error) {
    logger.error('hasProcessedInboundMessage failed', { messageId, message: error.message });
    throw error;
  }
  return !!(data && data.length);
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
 * Permanently suppress an address after an SES hard bounce or spam
 * complaint (see routes/sesWebhook.js) -- stops the sequence the same way
 * /unsubscribe does, plus logs one outreach_logs row per affected lead so
 * the reason is auditable.
 */
async function suppressEmailAddress(email, reason) {
  const db = getClient();
  const { data: leads, error: findErr } = await db.from(TABLE).select('id, place_id').eq('email', email);
  if (findErr) {
    logger.error('suppressEmailAddress lookup failed', { email, message: findErr.message });
    throw findErr;
  }

  await stopEmailByAddress(email);

  for (const lead of leads || []) {
    await logOutreach({
      leadId: lead.id,
      placeId: lead.place_id,
      channel: 'email',
      status: reason,
      message: `Suppressed: ${reason}`,
    });
  }

  return { suppressed: (leads || []).length };
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

/**
 * Today's stage-1 (new-lead) send counts grouped by sender mailbox, for the
 * sender-rotation load balancer to pick the least-loaded mailbox that hasn't
 * hit its per-sender daily cap.
 */
async function getSenderNewLeadCountsToday() {
  const db = getClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { data, error } = await db
    .from(LOGS_TABLE)
    .select('sender')
    .eq('channel', 'email')
    .eq('stage', 1)
    .not('sender', 'is', null)
    .gte('created_at', startOfDay.toISOString());

  if (error) {
    logger.error('getSenderNewLeadCountsToday failed', { message: error.message });
    throw error;
  }

  const counts = {};
  for (const row of data || []) counts[row.sender] = (counts[row.sender] || 0) + 1;
  return counts;
}

/**
 * Earliest stage-1 send date per sender mailbox — the anchor for the sender
 * warm-up ramp (a brand-new mailbox starts at a conservative daily cap that
 * increases the longer it's been sending, rather than jumping straight to
 * the full per-sender cap on day one).
 */
async function getSenderFirstSendDates() {
  const db = getClient();
  const { data, error } = await db
    .from(LOGS_TABLE)
    .select('sender, created_at')
    .eq('channel', 'email')
    .eq('stage', 1)
    .not('sender', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    logger.error('getSenderFirstSendDates failed', { message: error.message });
    throw error;
  }

  const firstSend = {};
  for (const row of data || []) {
    if (!firstSend[row.sender]) firstSend[row.sender] = row.created_at; // ascending order -> first occurrence is earliest
  }
  return firstSend;
}

/**
 * Lock a lead to the mailbox that sent its stage-1 email, so every follow-up
 * in its sequence comes from the same address (reply continuity, and the
 * thing that guarantees no lead is ever double-contacted by two mailboxes).
 */
async function setAssignedSender(placeId, sender) {
  const db = getClient();
  const { error } = await db.from(TABLE).update({ assigned_sender: sender }).eq('place_id', placeId);
  if (error) {
    logger.error('setAssignedSender failed', { placeId, message: error.message });
    throw error;
  }
}

/**
 * Reply-rate breakdown by subject-line variant, pain-point angle, and stage —
 * the actual data points behind "who replied and what worked" instead of
 * guessing. Caveat: a reply is attributed to every stage/variant/pain-point
 * sent to that lead (we don't know which specific email triggered a reply,
 * only that the lead replied at some point in their sequence) — treat this
 * as an engagement proxy across a lead's whole thread, not per-message
 * attribution. Still useful once volume builds up: a variant/angle that's
 * consistently present in replied threads and rare in dead ones is a signal.
 */
async function getEmailPerformanceStats() {
  const db = getClient();
  const [{ data: logs, error: logsErr }, { data: leads, error: leadsErr }] = await Promise.all([
    db.from(LOGS_TABLE).select('place_id, stage, subject_variant, pain_point, sender').eq('channel', 'email').not('stage', 'is', null),
    db.from(TABLE).select('place_id, email_replied'),
  ]);
  if (logsErr) {
    logger.error('getEmailPerformanceStats logs query failed', { message: logsErr.message });
    throw logsErr;
  }
  if (leadsErr) {
    logger.error('getEmailPerformanceStats leads query failed', { message: leadsErr.message });
    throw leadsErr;
  }

  const repliedSet = new Set((leads || []).filter((l) => l.email_replied).map((l) => l.place_id));

  const bySubjectVariant = {};
  const byPainPoint = {};
  const byStage = {};
  const bySender = {};
  const bump = (bucket, key, replied) => {
    bucket[key] = bucket[key] || { sent: 0, replied: 0 };
    bucket[key].sent++;
    if (replied) bucket[key].replied++;
  };

  for (const log of logs || []) {
    const replied = repliedSet.has(log.place_id);
    if (log.subject_variant !== null && log.subject_variant !== undefined) bump(bySubjectVariant, log.subject_variant, replied);
    if (log.pain_point) bump(byPainPoint, log.pain_point, replied);
    if (log.stage) bump(byStage, log.stage, replied);
    if (log.sender) bump(bySender, log.sender, replied);
  }

  const withRate = (bucket) =>
    Object.fromEntries(
      Object.entries(bucket).map(([k, v]) => [k, { ...v, replyRate: v.sent ? +((v.replied / v.sent) * 100).toFixed(1) : 0 }])
    );

  return {
    bySubjectVariant: withRate(bySubjectVariant),
    byPainPoint: withRate(byPainPoint),
    byStage: withRate(byStage),
    bySender: withRate(bySender),
  };
}

// ─── Discovery pipeline: niche/geo rotation history ───────────────────────────

const SEARCH_HISTORY_TABLE = 'search_history';

/**
 * (niche, city) pairs searched within the last `days` days, as "niche|city"
 * keys — used by rotation.js to exclude recently-mined pairs from today's pick.
 */
async function getRecentSearchHistory(days = 180) {
  const db = getClient();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await db
    .from(SEARCH_HISTORY_TABLE)
    .select('niche, city')
    .gte('searched_at', since);

  if (error) {
    logger.error('getRecentSearchHistory failed', { message: error.message });
    throw error;
  }
  return new Set((data || []).map((r) => `${r.niche}|${r.city}`));
}

/**
 * Record today's (niche, city, state) picks so future runs exclude them for
 * the cooldown window.
 */
async function recordSearchHistory(pairs) {
  if (!pairs.length) return;
  const db = getClient();
  const rows = pairs.map((p) => ({ niche: p.niche, city: p.city, state: p.state }));
  const { error } = await db.from(SEARCH_HISTORY_TABLE).insert(rows);
  if (error) {
    logger.error('recordSearchHistory failed', { message: error.message });
    throw error;
  }
}

// ─── Discovery pipeline: dedup against existing leads ─────────────────────────

/**
 * The identifiers already in the `leads` table, for candidate-pool dedup
 * before anything gets scored/enriched: place_id, normalized domain, and
 * email. Pulled once per pipeline run rather than queried per-candidate.
 */
async function getExistingLeadIdentifiers() {
  const db = getClient();
  const { data, error } = await db.from(TABLE).select('place_id, domain, email, name, city');
  if (error) {
    logger.error('getExistingLeadIdentifiers failed', { message: error.message });
    throw error;
  }
  return data || [];
}

module.exports = {
  upsertLeads,
  getLeads,
  updateEnrichment,
  markOutreachSent,
  logOutreach,
  getOutreachLogs,
  suppressEmailAddress,
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
  getEmailPerformanceStats,
  getSenderNewLeadCountsToday,
  getSenderFirstSendDates,
  setAssignedSender,
  getDecoyStageLeadsBySenderAndEmail,
  getLastDecoyMessageId,
  markPivotSent,
  getPostPivotAwaitingBookingLeads,
  markBookingSent,
  hasProcessedInboundMessage,
  getRecentSearchHistory,
  recordSearchHistory,
  getExistingLeadIdentifiers,
};
