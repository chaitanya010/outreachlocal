'use strict';

/**
 * Cold-email sequence engine (FootWord's outreach-core.js pattern, adapted to
 * real Supabase columns instead of sentinel rows).
 *
 * One 4-stage sequence per lead: intro (day 0) -> value (day 3) ->
 * free redesign offer (day 7) -> last touch (day 14). Each invocation of
 * runOnce() sends AT MOST ONE email, gated by a daily cap and a minimum gap
 * since the last send — cadence is enforced by how often the caller (a cron
 * job / external scheduler) invokes this, not by an internal scheduler.
 */

const {
  getEmailSequenceCandidates,
  recordEmailStageSent,
  setEmailFlag,
  logOutreach,
  countEmailSendsToday,
  countNewLeadEmailsSentToday,
  getLastEmailSendTime,
  getEmailSequenceStats,
} = require('../db/leadsRepository');
const { generateEmail } = require('./aiMessageService');
const { sendEmail } = require('./emailService');
const { getDeckAttachment } = require('../utils/deckAttachment');
const logger = require('../utils/logger');

// Overall safety valve on total sequence volume/day (new + follow-ups).
const DAILY_CAP = parseInt(process.env.EMAIL_DAILY_CAP || '30', 10);
// The specific "10 new businesses/day" ask — tracked separately so follow-ups
// to leads who already had contact are never blocked by the new-intro cap.
const NEW_LEADS_PER_DAY = parseInt(process.env.EMAIL_NEW_LEADS_PER_DAY || '10', 10);
const MIN_GAP_MINUTES = parseInt(process.env.EMAIL_MIN_GAP_MINUTES || '20', 10);
const MAX_JITTER_MINUTES = 45;

async function sendStage(lead, stage) {
  const content = await generateEmail(lead, stage);
  const attachments = stage === 1 ? [getDeckAttachment()].filter(Boolean) : undefined;
  const result = await sendEmail({
    to: lead.email,
    replyTo: process.env.RESEND_FROM_EMAIL,
    ...content,
    attachments,
  });

  await recordEmailStageSent(lead.place_id, stage);
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email',
    status: 'sent',
    message: content.subject,
    provider_id: result.messageId,
    stage,
  });

  logger.info('Email sequence: stage sent', { place_id: lead.place_id, stage, messageId: result.messageId });
  return result;
}

/**
 * Pick the single highest-priority due lead + stage, without sending.
 * Follow-ups are returned ahead of fresh intros (see leadsRepository sort).
 */
async function peekNextCandidate() {
  const candidates = await getEmailSequenceCandidates(1);
  return candidates.length ? candidates[0] : null;
}

/**
 * Run one drip cycle: enforce the overall daily cap + min gap, then send at
 * most one email — a due follow-up if one exists, otherwise a fresh intro
 * (skipped if the day's new-lead cap of NEW_LEADS_PER_DAY is already hit).
 */
async function runOnce({ dailyCap = DAILY_CAP, minGapMinutes = MIN_GAP_MINUTES } = {}) {
  const sentToday = await countEmailSendsToday();
  if (sentToday >= dailyCap) {
    return { sent: false, reason: 'daily_cap_reached', sentToday, dailyCap };
  }

  const lastSentAt = await getLastEmailSendTime();
  if (lastSentAt) {
    const minutesSince = (Date.now() - Date.parse(lastSentAt)) / 60000;
    const jitter = Math.random() * MAX_JITTER_MINUTES;
    const requiredGap = minGapMinutes + jitter;
    if (minutesSince < requiredGap) {
      return { sent: false, reason: 'min_gap_not_elapsed', minutesSince: Math.round(minutesSince), requiredGap: Math.round(requiredGap) };
    }
  }

  // Look at a small window of due candidates (follow-ups first) so a
  // maxed-out new-lead cap doesn't block a genuinely due follow-up, and vice
  // versa: if the only due candidates are new leads and the cap's hit, no-op.
  const candidates = await getEmailSequenceCandidates(10);
  if (!candidates.length) return { sent: false, reason: 'no_candidates' };

  let newSentToday = null;
  for (const { lead, nextStage, isNew } of candidates) {
    if (isNew) {
      if (newSentToday === null) newSentToday = await countNewLeadEmailsSentToday();
      if (newSentToday >= NEW_LEADS_PER_DAY) continue; // new-lead cap hit, try next candidate
    }

    try {
      const result = await sendStage(lead, nextStage);
      return { sent: true, place_id: lead.place_id, stage: nextStage, isNew: !!isNew, messageId: result.messageId };
    } catch (err) {
      logger.error('Email sequence: send failed', { place_id: lead.place_id, stage: nextStage, message: err.message });
      return { sent: false, reason: 'send_failed', place_id: lead.place_id, stage: nextStage, error: err.message };
    }
  }

  return { sent: false, reason: 'new_lead_cap_reached', newLeadsPerDay: NEW_LEADS_PER_DAY };
}

async function markReplied(placeId) {
  return setEmailFlag(placeId, 'replied');
}

async function markStopped(placeId) {
  return setEmailFlag(placeId, 'stopped');
}

module.exports = {
  runOnce,
  peekNextCandidate,
  markReplied,
  markStopped,
  getEmailSequenceStats,
};
