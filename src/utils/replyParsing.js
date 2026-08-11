'use strict';

/**
 * Pure helpers for turning a raw inbound IMAP message into something safe to
 * classify -- separated from replyWatcher.js's IMAP/DB orchestration so these
 * stay unit-testable without mocking ImapFlow or OpenAI.
 */

const { simpleParser } = require('mailparser');

/**
 * Parse a raw RFC822 message source (as returned by ImapFlow's
 * `fetchOne(uid, { source: true })`) into plain text body + headers.
 * @param {Buffer|string} rawSource
 * @returns {Promise<{ text: string, subject: string, headers: Map }>}
 */
async function parseInboundMessage(rawSource) {
  const parsed = await simpleParser(rawSource);
  return {
    text: parsed.text || '',
    subject: parsed.subject || '',
    headers: parsed.headers || new Map(),
  };
}

// Vacation/OOO autoresponders -- the address is still valid, the person is
// just away, so these should be ignored (not suppressed).
const OOO_SUBJECT_RE = /^(auto[- ]?reply|out of office|automatic reply|automatisch|abwesenheit)/i;

// Delivery-failure signals -- distinct from OOO because these mean the
// address is dead (or the mailbox owner is saying it's no longer read) and
// must never be retried. The primary, authoritative bounce path is SES's own
// async bounce notification via SNS (see routes/sesWebhook.js), which is
// what actually fires for most real hard bounces since SES rejects delivery
// mailbox-side, not via a reply landing in our own inbox. This is a backup
// signal for the narrower case where a same-address auto-response itself
// indicates the address won't be effectively read (mailbox full and staying
// that way, "no longer with this company", forwarding notices, etc.) --
// something SES's own bounce feedback wouldn't catch since SES still
// successfully delivered the message.
const BOUNCE_SUBJECT_RE = /^(undeliverable|delivery status notification|mail delivery failed|returned mail|failure notice|delivery has failed|message (could not be delivered|was not delivered|delayed))/i;

/**
 * @param {Map} headers  parsed message headers (mailparser Map)
 * @param {string} subject
 * @returns {boolean}
 */
function isBounceNotification(headers, subject = '') {
  const contentType = headers && typeof headers.get === 'function' ? headers.get('content-type') : null;
  const contentTypeValue = contentType && typeof contentType === 'object' ? contentType.value : contentType;
  if (contentTypeValue && /multipart\/report/i.test(String(contentTypeValue))) {
    const reportType = contentType.params && contentType.params['report-type'];
    if (!reportType || /delivery-status/i.test(reportType)) return true;
  }
  return BOUNCE_SUBJECT_RE.test((subject || '').trim());
}

/**
 * @param {Map} headers  parsed message headers (mailparser Map)
 * @param {string} subject
 * @returns {boolean}
 */
function isAutoSubmitted(headers, subject = '') {
  const autoSubmitted = headers && typeof headers.get === 'function' ? headers.get('auto-submitted') : null;
  if (autoSubmitted && String(autoSubmitted).toLowerCase() !== 'no') return true;
  if (isBounceNotification(headers, subject)) return true;
  if (OOO_SUBJECT_RE.test((subject || '').trim())) return true;
  return false;
}

// Strips the quoted original message from a reply body so classification
// only sees what the person actually typed. Cuts at the first line matching
// a common quote-start marker, or the first run of "> " quoted lines.
const QUOTE_MARKERS_RE = /^(on .+ wrote:|-{2,}\s*original message\s*-{2,}|from:\s*.+)$/im;

function stripQuotedReply(text) {
  if (!text) return '';
  const markerMatch = QUOTE_MARKERS_RE.exec(text);
  let body = markerMatch ? text.slice(0, markerMatch.index) : text;

  const lines = body.split('\n');
  const cutIdx = lines.findIndex((line) => line.trim().startsWith('>'));
  if (cutIdx !== -1) body = lines.slice(0, cutIdx).join('\n');

  return body.trim();
}

module.exports = { parseInboundMessage, isAutoSubmitted, isBounceNotification, stripQuotedReply };
