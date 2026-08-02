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

// Common auto-reply / OOO / delivery-failure signals. Auto-Submitted is the
// standards-based signal (RFC 3834) and takes priority; the subject regex is
// a fallback for autoresponders that don't set it (common in practice).
const AUTO_SUBJECT_RE = /^(auto[- ]?reply|out of office|automatic reply|undeliverable|delivery status notification|automatisch|abwesenheit)/i;

/**
 * @param {Map} headers  parsed message headers (mailparser Map)
 * @param {string} subject
 * @returns {boolean}
 */
function isAutoSubmitted(headers, subject = '') {
  const autoSubmitted = headers && typeof headers.get === 'function' ? headers.get('auto-submitted') : null;
  if (autoSubmitted && String(autoSubmitted).toLowerCase() !== 'no') return true;
  if (AUTO_SUBJECT_RE.test((subject || '').trim())) return true;
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

module.exports = { parseInboundMessage, isAutoSubmitted, stripQuotedReply };
