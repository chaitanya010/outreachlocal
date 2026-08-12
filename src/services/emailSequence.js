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
 * runOnce() can be called by more than one independent scheduler (Railway's
 * in-process cron, and a GitHub-Actions fallback runner that executes this
 * same module directly against Supabase -- see scripts/fallbackOutreachRun.js
 * -- so daily outreach still happens if Railway itself is temporarily down).
 * The in-process `runInProgress` lock only protects against two overlapping
 * calls within the SAME process; the thing that actually makes two different
 * processes/machines calling this at the same moment safe is the atomic
 * per-lead claim in claimLeadForStage() (leadsRepository.js) -- a lead is
 * only ever sent to once a worker has won that claim, so two workers racing
 * for the same due lead can never both send it.
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
  claimLeadForStage,
  releaseClaim,
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
const { isWithinBusinessHours } = require('../utils/timezone');
const logger = require('../utils/logger');

// Hard outer ceiling on total sequence volume/day (new + follow-ups), across
// all senders combined -- deliberately set well above the highest possible
// warmup-derived total (5 mailboxes x 15/day fully warmed = 75) so it only
// ever binds if someone explicitly lowers EMAIL_DAILY_CAP to intentionally
// throttle below the ramp, not as the everyday driver (see computeDailyCap).
const DAILY_CAP_CEILING = parseInt(process.env.EMAIL_DAILY_CAP || '100', 10);
// Absolute floor on time between sends, regardless of how much daily budget
// remains -- prevents the adaptive pacing below from ever bursting sends
// back-to-back even if the day's cap is large and time is short.
const MIN_GAP_MINUTES = parseInt(process.env.EMAIL_MIN_GAP_MINUTES || '5', 10);
const MAX_JITTER_MINUTES = 45;
const BUSINESS_HOUR_START = parseInt(process.env.EMAIL_BUSINESS_HOUR_START || '9', 10);
const BUSINESS_HOUR_END = parseInt(process.env.EMAIL_BUSINESS_HOUR_END || '17', 10);
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || 'America/New_York';

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
 * Today's total daily cap = sum of every mailbox's own warmup-adjusted cap
 * (see warmupCapFor), so total volume automatically ramps 25 -> 50 -> 75 as
 * the 5-mailbox pool ages, instead of a fixed number that ignores how many
 * mailboxes are actually warmed up. Still bounded by DAILY_CAP_CEILING as an
 * explicit safety valve.
 */
async function computeDailyCap() {
  if (!SENDER_POOL.length) return DAILY_CAP_CEILING;
  const firstSends = await getSenderFirstSendDates();
  const warmupTotal = SENDER_POOL.reduce((sum, s) => sum + warmupCapFor(firstSends[s]), 0);
  return Math.min(warmupTotal, DAILY_CAP_CEILING);
}

/** Minutes remaining today until BUSINESS_HOUR_END, in CRON_TIMEZONE (0 if already past). */
function minutesUntilWindowCloses(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRON_TIMEZONE,
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = parseInt(parts.find((p) => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute').value, 10);
  const nowMinutes = hour * 60 + minute;
  const closeMinutes = BUSINESS_HOUR_END * 60;
  return Math.max(closeMinutes - nowMinutes, 0);
}

/**
 * Adaptive target gap: spreads however many sends remain today evenly across
 * however much of the business-hours window is left, recomputed every call.
 * This is what actually makes computeDailyCap's ramp reachable -- a fixed gap
 * (the old behavior) capped total output at ~11-12/day regardless of how high
 * the daily cap climbed. Self-correcting: if a send is late, the shrinking
 * window vs. unchanged remaining-sends count naturally shortens the next
 * required gap to catch up, rather than needing to hit every slot exactly.
 * Floors at minGapMinutes so it never bursts sends back-to-back.
 */
function computeRequiredGap(remainingSends, remainingWindowMinutes, minGapMinutes) {
  if (remainingSends <= 0 || remainingWindowMinutes <= 0) return minGapMinutes;
  return Math.max(remainingWindowMinutes / remainingSends, minGapMinutes);
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

// Two independent triggers call runOnce() on the same running process — the
// internal node-cron tick and the GitHub Actions workflow hitting
// /outreach/email/run (both roughly every 30min, sometimes within seconds of
// each other). Without this lock, two overlapping calls could both read
// "no send due yet" before either had written its result, and both send the
// same due lead's next stage. All of runOnce()'s DB reads happen before its
// one write (recordEmailStageSent), so a simple in-process mutex closes that
// window; it does not protect against multiple server instances, but this
// service runs as a single Railway process.
let runInProgress = false;

/**
 * Run one drip cycle: enforce the overall daily cap + an adaptive min gap,
 * then send at most one email — a due follow-up if one exists, otherwise a
 * fresh intro (skipped once every mailbox in the pool has hit its own
 * per-sender cap). dailyCap defaults to the warmup-derived total
 * (computeDailyCap) rather than a fixed number, so it ramps automatically as
 * mailboxes age; minGapMinutes is the pacing floor, not the target -- the
 * actual target gap adapts to how much of today's cap and business-hours
 * window remain (see computeRequiredGap).
 */
async function runOnce({ dailyCap, minGapMinutes = MIN_GAP_MINUTES, workerId = process.env.WORKER_ID || 'railway' } = {}) {
  if (runInProgress) {
    return { sent: false, reason: 'run_already_in_progress' };
  }
  runInProgress = true;
  try {
    const effectiveDailyCap = dailyCap ?? (await computeDailyCap());
    const sentToday = await countEmailSendsToday();
    if (sentToday >= effectiveDailyCap) {
      return { sent: false, reason: 'daily_cap_reached', sentToday, dailyCap: effectiveDailyCap };
    }

    const lastSentAt = await getLastEmailSendTime();
    if (lastSentAt) {
      const remainingSends = effectiveDailyCap - sentToday;
      const remainingWindowMinutes = minutesUntilWindowCloses();
      const targetGap = computeRequiredGap(remainingSends, remainingWindowMinutes, minGapMinutes);
      // Jitter scales with the target gap itself (capped at MAX_JITTER_MINUTES)
      // so a small adaptive gap late in a busy day isn't swamped by up to 45min
      // of jitter -- keeps the send pattern non-robotic without undermining the
      // pacing that makes the daily cap reachable.
      const jitter = Math.random() * Math.min(MAX_JITTER_MINUTES, targetGap * 0.5);
      const requiredGap = targetGap + jitter;
      const minutesSince = (Date.now() - Date.parse(lastSentAt)) / 60000;
      if (minutesSince < requiredGap) {
        return { sent: false, reason: 'min_gap_not_elapsed', minutesSince: Math.round(minutesSince), requiredGap: Math.round(requiredGap) };
      }
    }

    // Look at a small window of due candidates (follow-ups first) so a
    // maxed-out new-lead cap doesn't block a genuinely due follow-up, and vice
    // versa: if the only due candidates are new leads and every sender's
    // capped, no-op. Widened from 10 to 25 now that leads span several
    // countries/timezones (see isWithinBusinessHours below) -- a bigger
    // window lowers the odds that every due candidate happens to be
    // out-of-hours in its own country right now.
    const candidates = await getEmailSequenceCandidates(25);
    if (!candidates.length) return { sent: false, reason: 'no_candidates' };

    let skippedForLocalHours = 0;
    for (const { lead, nextStage, isNew } of candidates) {
      // Don't email a lead outside its own local business hours -- fixed
      // purely to New York time, an Australian lead would get sent to at
      // 11pm-7am their time. Leave it for a later tick once it's actually a
      // reasonable hour there.
      if (!isWithinBusinessHours(lead.country, BUSINESS_HOUR_START, BUSINESS_HOUR_END)) {
        skippedForLocalHours++;
        continue;
      }

      // Cross-process/cross-machine guard: two workers (Railway + the
      // GitHub-Actions fallback, or two overlapping Railway triggers) can
      // both reach this point for the same lead. Only one atomic UPDATE can
      // ever match this lead's current email_stage, so only one worker wins
      // the claim -- the other simply moves on to the next candidate rather
      // than sending a duplicate.
      const claimed = await claimLeadForStage(lead.place_id, lead.email_stage || 0, workerId);
      if (!claimed) continue;

      let sender;
      if (isNew) {
        sender = await pickLeastLoadedSender();
        if (!sender) {
          await releaseClaim(lead.place_id); // no sender available -- free the lead back up immediately, not after the claim timeout
          continue; // every mailbox hit its per-sender new-lead cap today, try next candidate
        }
      } else {
        sender = lead.assigned_sender || SENDER_POOL[0];
      }

      try {
        const result = await sendStage(lead, nextStage, sender); // recordEmailStageSent (inside sendStage) also clears the claim on success
        await resetFailureStreak('email_send');
        return { sent: true, place_id: lead.place_id, stage: nextStage, isNew: !!isNew, sender, messageId: result.messageId, workerId };
      } catch (err) {
        logger.error('Email sequence: send failed', { place_id: lead.place_id, stage: nextStage, message: err.message });
        await releaseClaim(lead.place_id); // free it up for retry on the next tick instead of sitting locked until the claim timeout
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

    if (skippedForLocalHours === candidates.length) {
      return { sent: false, reason: 'no_leads_in_local_business_hours', skipped: skippedForLocalHours };
    }
    return { sent: false, reason: 'new_lead_cap_reached', perSenderCap: PER_SENDER_NEW_LEADS_PER_DAY, senderPoolSize: SENDER_POOL.length };
  } finally {
    runInProgress = false;
  }
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
