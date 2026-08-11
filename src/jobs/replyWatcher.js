'use strict';

/**
 * Polls each mailbox in EMAIL_SENDER_POOL's real IMAP inbox (Titan, via
 * GoDaddy's IMAP host) for replies from leads at either of two stages:
 *
 *   1. Decoy stage ("what time do you close today?" -- see
 *      aiMessageService.generateDecoyOpener): a reply here is classified
 *      (classifyReply) and, if genuine, gets the pivot/reveal email (with
 *      the deck attached, see generatePivotEmail).
 *   2. Post-pivot stage: a reply to the pivot's "would it be worth a short
 *      chat?" is classified separately (classifyPostPivotReply) and, if it
 *      signals real interest, gets the booking-link email (generateBookingEmail)
 *      -- this is the step that actually closes the loop to a booked demo.
 *
 * Every inbound message is classified with an Auto-Submitted-header/subject
 * fast-path ahead of the LLM call (see utils/replyParsing.js) before acting
 * on it, instead of treating any reply as interest:
 *   - auto_reply (OOO/bounce/autoresponder) -> ignored entirely, lead stays
 *     at its current stage so a later real reply still works normally.
 *   - not_interested (asks to stop/unsubscribe, or hostile) -> silently
 *     suppressed (suppressEmailAddress + setEmailFlag 'stopped'), nothing
 *     sent back, at either stage.
 *   - decoy stage: interested/other -> pivot email, opener line personalized
 *     via personalizePivotOpener when possible.
 *   - post-pivot stage: wants_meeting -> booking email + notifyOwner;
 *     other (a real question/ambiguous) -> notifyOwner only, no automated
 *     send -- a live sales conversation with a real prospect is too
 *     high-stakes to hand to an LLM without review, so this is the safety
 *     valve: you get pinged to reply personally instead.
 *
 * Deliberately does NOT rely on IMAP \Seen flags for dedup -- these are real
 * mailboxes someone may also check manually, and marking messages read as a
 * side effect of polling would be surprising. Dedup instead goes through
 * hasProcessedInboundMessage() (Message-ID lookup in outreach_logs).
 */

const cron = require('node-cron');
const { ImapFlow } = require('imapflow');
const {
  getDecoyStageLeadsBySenderAndEmail,
  getLastDecoyMessageId,
  markPivotSent,
  getPostPivotAwaitingBookingLeads,
  markBookingSent,
  hasProcessedInboundMessage,
  setEmailFlag,
  logOutreach,
  suppressEmailAddress,
} = require('../db/leadsRepository');
const {
  generatePivotEmail,
  classifyReply,
  personalizePivotOpener,
  classifyPostPivotReply,
  generateBookingEmail,
} = require('../services/aiMessageService');
const { senderNameFor } = require('../services/emailSequence');
const { sendEmail } = require('../services/emailService');
const { getDeckAttachment } = require('../utils/deckAttachment');
const { parseInboundMessage, isAutoSubmitted, isBounceNotification, stripQuotedReply } = require('../utils/replyParsing');
const { notifyOwner } = require('../utils/notify');
const logger = require('../utils/logger');

const IMAP_HOST = process.env.EMAIL_IMAP_HOST;
const IMAP_PORT = parseInt(process.env.EMAIL_IMAP_PORT || '993', 10);
const TICK_MINUTES = parseInt(process.env.REPLY_WATCHER_TICK_MINUTES || '5', 10);
const LOOKBACK_HOURS = parseInt(process.env.REPLY_WATCHER_LOOKBACK_HOURS || '72', 10);

function parseSenderPool() {
  const raw = process.env.EMAIL_SENDER_POOL || process.env.SES_FROM_EMAIL || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseImapPasswords(pool) {
  const raw = (process.env.EMAIL_IMAP_PASSWORDS || '').split(',').map((s) => s.trim());
  return pool.map((_, i) => raw[i] || null);
}

const SENDER_POOL = parseSenderPool();
const IMAP_PASSWORDS = parseImapPasswords(SENDER_POOL);

async function handleInboundMessage(senderEmail, envelope, rawSource) {
  const fromAddress = envelope.from?.[0]?.address?.toLowerCase();
  const inboundMessageId = envelope.messageId;
  if (!fromAddress || fromAddress === senderEmail.toLowerCase()) return; // ignore self-sent/no sender
  if (!inboundMessageId) return;

  const decoyLead = await getDecoyStageLeadsBySenderAndEmail(senderEmail, fromAddress);
  if (decoyLead) {
    if (await hasProcessedInboundMessage(inboundMessageId)) return; // already handled this exact message
    return handleDecoyReply(decoyLead, senderEmail, fromAddress, envelope, rawSource, inboundMessageId);
  }

  const postPivotLead = await getPostPivotAwaitingBookingLeads(senderEmail, fromAddress);
  if (postPivotLead) {
    if (await hasProcessedInboundMessage(inboundMessageId)) return; // already handled this exact message
    return handlePostPivotReply(postPivotLead, senderEmail, fromAddress, envelope, rawSource, inboundMessageId);
  }
  // not a reply from anyone at a stage this watcher acts on (already booked, never a lead, etc.)
}

async function handleDecoyReply(lead, senderEmail, fromAddress, envelope, rawSource, inboundMessageId) {
  const { text: rawText, subject, headers: inboundHeaders } = await parseInboundMessage(rawSource);
  const replyText = stripQuotedReply(rawText);
  const intent = isAutoSubmitted(inboundHeaders, subject) ? 'auto_reply' : await classifyReply(replyText, subject);

  if (intent === 'auto_reply') {
    if (isBounceNotification(inboundHeaders, subject)) {
      // A delivery-failure signal arriving as a same-address reply (mailbox
      // full and staying that way, "no longer with this company", etc.) --
      // SES's own bounce webhook (routes/sesWebhook.js) is the primary path
      // for real hard bounces, but this catches the narrower case where SES
      // still delivered the message yet the address itself indicates it
      // won't be effectively read. Suppress the same way a bounce or
      // opt-out does -- never retry it.
      logger.info('replyWatcher: bounce-pattern reply, suppressing', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
      await logOutreach({
        leadId: lead.id,
        placeId: lead.place_id,
        channel: 'email_reply',
        status: 'received',
        message: subject || '',
        provider_id: inboundMessageId,
      });
      await setEmailFlag(lead.place_id, 'stopped');
      await suppressEmailAddress(fromAddress, 'reply_bounce_pattern');
      return;
    }
    // Not a real reply (OOO/autoresponder) -- log for dedup + visibility
    // only. Lead stays in the decoy stage untouched, so a genuine reply
    // later still triggers the pivot normally.
    logger.info('replyWatcher: auto-reply ignored', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
    await logOutreach({
      leadId: lead.id,
      placeId: lead.place_id,
      channel: 'email_reply',
      status: 'auto_reply_ignored',
      message: subject || '',
      provider_id: inboundMessageId,
    });
    return;
  }

  if (intent === 'not_interested') {
    // Silent suppression per spec -- no reply sent, address suppressed
    // sequence-wide via the same path the SES bounce/complaint webhook uses.
    logger.info('replyWatcher: opt-out via reply, suppressing', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
    await logOutreach({
      leadId: lead.id,
      placeId: lead.place_id,
      channel: 'email_reply',
      status: 'received',
      message: subject || '',
      provider_id: inboundMessageId,
    });
    await setEmailFlag(lead.place_id, 'stopped');
    await suppressEmailAddress(fromAddress, 'reply_opt_out');
    return;
  }

  logger.info('replyWatcher: reply detected', { place_id: lead.place_id, sender: senderEmail, from: fromAddress, intent });

  await setEmailFlag(lead.place_id, 'replied');
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email_reply',
    status: 'received',
    message: subject || '',
    provider_id: inboundMessageId,
  });

  const senderName = senderNameFor(senderEmail);
  const opener = await personalizePivotOpener(replyText, lead.name);
  const content = generatePivotEmail(lead, senderName, opener);
  const originalMessageId = await getLastDecoyMessageId(lead.place_id);
  const headers = { ...(content.headers || {}) };
  if (originalMessageId) {
    headers['In-Reply-To'] = originalMessageId;
    headers['References'] = originalMessageId;
  }

  const deck = getDeckAttachment();
  const result = await sendEmail({
    to: lead.email,
    from: senderEmail,
    fromName: senderName,
    replyTo: senderEmail,
    subject: content.subject,
    text: content.text,
    headers,
    attachments: deck ? [deck] : undefined,
  });

  await markPivotSent(lead.place_id);
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email',
    status: 'sent',
    message: content.subject,
    provider_id: result.messageId,
    sender: senderEmail,
  });

  logger.info('replyWatcher: pivot sent', { place_id: lead.place_id, sender: senderEmail, messageId: result.messageId, deckAttached: !!deck });
}

async function handlePostPivotReply(lead, senderEmail, fromAddress, envelope, rawSource, inboundMessageId) {
  const { text: rawText, subject, headers: inboundHeaders } = await parseInboundMessage(rawSource);
  const replyText = stripQuotedReply(rawText);
  const intent = isAutoSubmitted(inboundHeaders, subject) ? 'auto_reply' : await classifyPostPivotReply(replyText, subject);

  if (intent === 'auto_reply') {
    if (isBounceNotification(inboundHeaders, subject)) {
      logger.info('replyWatcher: post-pivot bounce-pattern reply, suppressing', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
      await logOutreach({
        leadId: lead.id,
        placeId: lead.place_id,
        channel: 'email_reply',
        status: 'received',
        message: subject || '',
        provider_id: inboundMessageId,
      });
      await setEmailFlag(lead.place_id, 'stopped');
      await suppressEmailAddress(fromAddress, 'reply_bounce_pattern');
      return;
    }
    // Not a real reply -- lead stays awaiting booking untouched, so a
    // genuine reply later still triggers the booking email normally.
    logger.info('replyWatcher: post-pivot auto-reply ignored', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
    await logOutreach({
      leadId: lead.id,
      placeId: lead.place_id,
      channel: 'email_reply',
      status: 'auto_reply_ignored',
      message: subject || '',
      provider_id: inboundMessageId,
    });
    return;
  }

  if (intent === 'not_interested') {
    logger.info('replyWatcher: post-pivot opt-out via reply, suppressing', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
    await logOutreach({
      leadId: lead.id,
      placeId: lead.place_id,
      channel: 'email_reply',
      status: 'received',
      message: subject || '',
      provider_id: inboundMessageId,
    });
    await setEmailFlag(lead.place_id, 'stopped');
    await suppressEmailAddress(fromAddress, 'reply_opt_out');
    return;
  }

  if (intent === 'other') {
    // A real question or something ambiguous -- too high-stakes to
    // auto-respond to. Log it and ping the owner to reply personally;
    // booking_sent stays false so a clearer reply later can still book.
    logger.info('replyWatcher: post-pivot reply needs manual follow-up', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
    await logOutreach({
      leadId: lead.id,
      placeId: lead.place_id,
      channel: 'email_reply',
      status: 'received',
      message: subject || '',
      provider_id: inboundMessageId,
    });
    await notifyOwner(
      `Needs your reply: ${lead.name}`,
      `${lead.name} <${lead.email}> replied to the pivot email and needs your personal follow-up (sent via ${senderEmail}):\n\n${replyText}`
    );
    return;
  }

  // wants_meeting
  logger.info('replyWatcher: post-pivot reply wants meeting, sending booking link', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email_reply',
    status: 'received',
    message: subject || '',
    provider_id: inboundMessageId,
  });

  const senderName = senderNameFor(senderEmail);
  const opener = await personalizePivotOpener(replyText, lead.name);
  const content = generateBookingEmail(lead, senderName, opener);
  const originalMessageId = await getLastDecoyMessageId(lead.place_id);
  const bookingHeaders = { ...(content.headers || {}) };
  if (originalMessageId) {
    bookingHeaders['In-Reply-To'] = originalMessageId;
    bookingHeaders['References'] = originalMessageId;
  }

  const result = await sendEmail({
    to: lead.email,
    from: senderEmail,
    fromName: senderName,
    replyTo: senderEmail,
    subject: content.subject,
    text: content.text,
    headers: bookingHeaders,
  });

  await markBookingSent(lead.place_id);
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email',
    status: 'sent',
    message: content.subject,
    provider_id: result.messageId,
    sender: senderEmail,
  });

  logger.info('replyWatcher: booking link sent', { place_id: lead.place_id, sender: senderEmail, messageId: result.messageId });
  await notifyOwner(
    `Booking link sent: ${lead.name}`,
    `${lead.name} <${lead.email}> replied wanting to book a demo -- the Calendly link was sent automatically (via ${senderEmail}). Watch for their booking.`
  );
}

/**
 * Poll one mailbox's inbox. Best-effort: any single mailbox failing (bad
 * creds, IMAP down) is logged and skipped, never blocks the others.
 */
async function pollMailbox(senderEmail, password) {
  if (!IMAP_HOST || !password) return;

  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: senderEmail, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const since = new Date(Date.now() - LOOKBACK_HOURS * 3600000);
      const uids = await client.search({ since }, { uid: true });
      for (const uid of uids || []) {
        const msg = await client.fetchOne(uid, { envelope: true, source: true }, { uid: true });
        if (!msg || !msg.envelope) continue;
        await handleInboundMessage(senderEmail, msg.envelope, msg.source);
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error('replyWatcher: mailbox poll failed', { sender: senderEmail, message: err.message });
  } finally {
    try {
      await client.logout();
    } catch (_err) {
      // connection already closed, nothing to do
    }
  }
}

async function tick() {
  for (let i = 0; i < SENDER_POOL.length; i++) {
    await pollMailbox(SENDER_POOL[i], IMAP_PASSWORDS[i]);
  }
}

let task = null;

function start() {
  if (task) return task;
  if (!IMAP_HOST) {
    logger.warn('Reply watcher not started: EMAIL_IMAP_HOST is not set');
    return null;
  }
  const configuredMailboxes = SENDER_POOL.filter((_, i) => IMAP_PASSWORDS[i]).length;
  if (!configuredMailboxes) {
    logger.warn('Reply watcher not started: no mailbox has an EMAIL_IMAP_PASSWORDS entry');
    return null;
  }

  const expr = `*/${TICK_MINUTES} * * * *`;
  task = cron.schedule(expr, tick);
  logger.info('Reply watcher cron started', { expr, configuredMailboxes });
  return task;
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

module.exports = { start, stop, tick };
