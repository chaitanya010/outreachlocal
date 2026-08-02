'use strict';

/**
 * Cold-email sequence engine (FootWord's outreach-core.js pattern, adapted to
 * real Supabase columns instead of sentinel rows).
 *
 * One 4-stage sequence per lead: decoy opener (day 0) -> decoy resend if no
 * reply (day 2) -> pain-point follow-up (day 7) -> last touch (day 14). Each
 * invocation of runOnce() sends AT MOST ONE email, gated by a daily cap and a
 * minimum gap since the last send — cadence is enforced by how often the
 * caller (a cron job / external scheduler) invokes this, not by an internal
 * scheduler.
 *
 * Stages 1-2 are deliberately NOT a pitch -- a short, genuine-sounding
 * question ("what time do you close today?") meant to read as a real
 * customer, not outreach, so the goal is a reply rather than a read. Once a
 * reply comes in (any time, detected by replyWatcher.js polling each
 * mailbox's IMAP inbox), the pivot/reveal email goes out automatically with
 * the deck attached -- see generatePivotEmail() in aiMessageService.js and
 * replyWatcher.js. If nobody replies to either decoy attempt, stages 3-4
 * fall back to the proven missed-calls pitch copy as a last resort.
 *
 * Multi-mailbox sender rotation: EMAIL_SENDER_POOL holds several @stanweb.tech
 * addresses (reputation isolation + higher combined daily volume than any one
 * mailbox could sustain alone). A lead is assigned ONE sender on its stage-1
 * send and stays with that mailbox for its whole sequence (assigned_sender on
 * the lead row) -- this is what guarantees no business is ever contacted by
 * two different mailboxes. New-lead volume is capped per-sender
 * (EMAIL_NEW_LEADS_PER_DAY_PER_SENDER) and load-balanced to whichever mailbox
 * has sent the fewest new intros today.
 */

const {
  getEmailSequenceCandidates,
  recordEmailStageSent,
  setEmailFlag,
  logOutreach,
  countEmailSendsToday,
  getSenderNewLeadCountsToday,
  getSenderFirstSendDates,
  setAssignedSender,
  getLastEmailSendTime,
  getEmailSequenceStats,
  getEmailPerformanceStats,
} = require('../db/leadsRepository');
const { generateEmail, generateDecoyOpener } = require('./aiMessageService');
const { sendEmail } = require('./emailService');
const { notifyOnRecurringFailure, resetFailureStreak } = require('../utils/notify');
const logger = require('../utils/logger');

// Overall safety valve on total sequence volume/day (new + follow-ups),
// across all senders combined.
const DAILY_CAP = parseInt(process.env.EMAIL_DAILY_CAP || '30', 10);
const MIN_GAP_MINUTES = parseInt(process.env.EMAIL_MIN_GAP_MINUTES || '20', 10);
const MAX_JITTER_MINUTES = 45;

// ─── Sender pool (multi-mailbox rotation) ──────────────────────────────────────

// EMAIL_SENDER_POOL: comma-separated list of @stanweb.tech addresses to rotate
// new leads across. EMAIL_SENDER_NAMES: matching comma-separated first names
// (same order/index) for the signature -- falls back to SENDER_NAME's first
// name for any sender without a matching entry. Falls back to a single-sender
// pool (SES_FROM_EMAIL) if EMAIL_SENDER_POOL is unset, so this is backward
// compatible with the original single-mailbox setup.
function parseSenderPool() {
  const raw = process.env.EMAIL_SENDER_POOL || process.env.SES_FROM_EMAIL || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseSenderNames(pool) {
  const raw = (process.env.EMAIL_SENDER_NAMES || '').split(',').map((s) => s.trim());
  const defaultFirstName = (process.env.SENDER_NAME || 'Chaitanya').split(/\s+/)[0];
  return pool.map((_, i) => raw[i] || defaultFirstName);
}

const SENDER_POOL = parseSenderPool();
const SENDER_NAMES = parseSenderNames(SENDER_POOL);
const PER_SENDER_NEW_LEADS_PER_DAY = parseInt(process.env.EMAIL_NEW_LEADS_PER_DAY_PER_SENDER || '20', 10);

function senderNameFor(email) {
  const idx = SENDER_POOL.indexOf(email);
  return idx >= 0 ? SENDER_NAMES[idx] : (process.env.SENDER_NAME || 'Chaitanya').split(/\s+/)[0];
}

// Warm-up ramp: a mailbox with no sending history is the riskiest thing to
// suddenly push to full volume, so new-lead volume per sender starts
// conservative and increases the longer that mailbox has actually been
// sending -- based on its own first stage-1 send date, not calendar
// assumptions. Caps out at PER_SENDER_NEW_LEADS_PER_DAY after ~3 weeks.
const WARMUP_SCHEDULE = [
  { afterDays: 0, cap: 5 },
  { afterDays: 7, cap: 10 },
  { afterDays: 14, cap: 15 },
  { afterDays: 21, cap: Infinity }, // Infinity -> use the full per-sender cap
];

function warmupCapFor(firstSendISO) {
  if (!firstSendISO) return WARMUP_SCHEDULE[0].cap; // never sent before -> most conservative
  const daysSince = (Date.now() - Date.parse(firstSendISO)) / 86400000;
  let cap = WARMUP_SCHEDULE[0].cap;
  for (const step of WARMUP_SCHEDULE) {
    if (daysSince >= step.afterDays) cap = step.cap;
  }
  return Math.min(cap, PER_SENDER_NEW_LEADS_PER_DAY);
}

/**
 * Pick the mailbox with the fewest new-lead (stage-1) sends today, among
 * those that haven't hit their (warm-up-adjusted) per-sender cap -- natural
 * load balancing across the pool. Returns null if every mailbox is maxed
 * out for the day.
 */
async function pickLeastLoadedSender() {
  if (!SENDER_POOL.length) return null;
  const [counts, firstSends] = await Promise.all([getSenderNewLeadCountsToday(), getSenderFirstSendDates()]);
  let best = null;
  let bestCount = Infinity;
  for (const s of SENDER_POOL) {
    const cap = warmupCapFor(firstSends[s]);
    const c = counts[s] || 0;
    if (c < cap && c < bestCount) {
      best = s;
      bestCount = c;
    }
  }
  return best;
}

async function sendStage(lead, stage, sender) {
  const senderName = senderNameFor(sender);
  // Stages 1-2 are the decoy opener (no pitch, no AI call needed); stages
  // 3-4 fall back to the pain-point pitch copy for leads who never replied
  // to either decoy attempt.
  const content = stage <= 2 ? generateDecoyOpener(lead, senderName, stage) : await generateEmail(lead, stage, senderName);
  // No attachment on any automated send -- confirmed via live testing to
  // trigger Gmail's Promotions tab. FootWord's proven-inbox templates never
  // attach anything either. The deck only goes out on the reply-triggered
  // pivot (see replyWatcher.js), never on a cold send.
  const result = await sendEmail({
    to: lead.email,
    from: sender,
    fromName: senderName,
    replyTo: sender,
    subject: content.subject,
    text: content.text,
    headers: content.headers,
  });

  await recordEmailStageSent(lead.place_id, stage);
  // Normally only needed on stage 1 (assigned once, for the lead's whole
  // sequence) -- also backfills any lead that reaches here with no
  // assigned_sender yet (e.g. contacted before assigned_sender existed) so
  // it can self-heal instead of staying permanently invisible to
  // replyWatcher.js, which requires an exact assigned_sender match.
  if (stage === 1 || !lead.assigned_sender) await setAssignedSender(lead.place_id, sender);
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email',
    status: 'sent',
    message: content.subject,
    provider_id: result.messageId,
    stage,
    subjectVariant: content.subjectVariant,
    painPoint: content.painPoint,
    sender,
  });

  logger.info('Email sequence: stage sent', { place_id: lead.place_id, stage, sender, messageId: result.messageId });
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
 * (skipped once every mailbox in the pool has hit its own per-sender cap).
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
  // versa: if the only due candidates are new leads and every sender's
  // capped, no-op.
  const candidates = await getEmailSequenceCandidates(10);
  if (!candidates.length) return { sent: false, reason: 'no_candidates' };

  for (const { lead, nextStage, isNew } of candidates) {
    let sender;
    if (isNew) {
      sender = await pickLeastLoadedSender();
      if (!sender) continue; // every mailbox hit its per-sender new-lead cap today, try next candidate
    } else {
      sender = lead.assigned_sender || SENDER_POOL[0];
    }

    try {
      const result = await sendStage(lead, nextStage, sender);
      resetFailureStreak('email_send');
      return { sent: true, place_id: lead.place_id, stage: nextStage, isNew: !!isNew, sender, messageId: result.messageId };
    } catch (err) {
      logger.error('Email sequence: send failed', { place_id: lead.place_id, stage: nextStage, message: err.message });
      // Previously swallowed entirely -- neither persisted nor surfaced, so a
      // sustained outage (bad creds, SES throttled) would silently no-op
      // forever with nothing to show for it. Now: a durable record + a
      // throttled alert (first failure, then every 5th) so a one-off blip
      // doesn't spam but a real outage still gets noticed fast.
      await logOutreach({
        leadId: lead.id,
        placeId: lead.place_id,
        channel: 'email',
        status: 'failed',
        message: `stage ${nextStage} send failed`,
        error: err.message,
        stage: nextStage,
        sender,
      });
      await notifyOnRecurringFailure(
        'email_send',
        'OutreachLocal: email send failed',
        `Failed to send stage ${nextStage} to ${lead.name} (${lead.email}) via ${sender}:\n\n${err.message}`
      );
      return { sent: false, reason: 'send_failed', place_id: lead.place_id, stage: nextStage, error: err.message };
    }
  }

  return { sent: false, reason: 'new_lead_cap_reached', perSenderCap: PER_SENDER_NEW_LEADS_PER_DAY, senderPoolSize: SENDER_POOL.length };
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
  senderNameFor,
  getEmailSequenceStats,
  getEmailPerformanceStats,
};
