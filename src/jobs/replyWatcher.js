'use strict';

/**
 * Polls each mailbox in EMAIL_SENDER_POOL's real IMAP inbox (Titan) for
 * replies from leads currently sitting in the decoy stage ("what time do you
 * close today?" -- see aiMessageService.generateDecoyOpener), and sends the
 * pivot/reveal email (with the deck attached, see generatePivotEmail) as
 * soon as one is found.
 *
 * Deliberately does NOT rely on IMAP \Seen flags for dedup -- these are real
 * mailboxes someone may also check manually, and marking messages read as a
 * side effect of polling would be surprising. Dedup instead goes through
 * hasProcessedInboundMessage() (Message-ID lookup in outreach_logs).
 *
 * Scope note: this only handles the FIRST reply to a decoy send (triggers
 * the one pivot email). Any further back-and-forth after that is NOT
 * auto-responded to -- a live sales conversation with a real prospect is too
 * high-stakes to hand to an LLM without review. Those later replies are
 * still logged (channel='email_reply') for visibility, just not acted on.
 */

const cron = require('node-cron');
const { ImapFlow } = require('imapflow');
const {
  getDecoyStageLeadsBySenderAndEmail,
  getLastDecoyMessageId,
  markPivotSent,
  hasProcessedInboundMessage,
  setEmailFlag,
  logOutreach,
} = require('../db/leadsRepository');
const { generatePivotEmail } = require('../services/aiMessageService');
const { senderNameFor } = require('../services/emailSequence');
const { sendEmail } = require('../services/emailService');
const { getDeckAttachment } = require('../utils/deckAttachment');
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

async function handleInboundMessage(senderEmail, envelope) {
  const fromAddress = envelope.from?.[0]?.address?.toLowerCase();
  const inboundMessageId = envelope.messageId;
  if (!fromAddress || fromAddress === senderEmail.toLowerCase()) return; // ignore self-sent/no sender
  if (!inboundMessageId) return;

  const lead = await getDecoyStageLeadsBySenderAndEmail(senderEmail, fromAddress);
  if (!lead) return; // not a reply from anyone currently in the decoy stage (already pivoted, or never a lead)

  if (await hasProcessedInboundMessage(inboundMessageId)) return; // already handled this exact message

  logger.info('replyWatcher: reply detected', { place_id: lead.place_id, sender: senderEmail, from: fromAddress });

  await setEmailFlag(lead.place_id, 'replied');
  await logOutreach({
    leadId: lead.id,
    placeId: lead.place_id,
    channel: 'email_reply',
    status: 'received',
    message: envelope.subject || '',
    provider_id: inboundMessageId,
  });

  const senderName = senderNameFor(senderEmail);
  const content = generatePivotEmail(lead, senderName);
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
        const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
        if (!msg || !msg.envelope) continue;
        await handleInboundMessage(senderEmail, msg.envelope);
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
