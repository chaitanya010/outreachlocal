'use strict';

const twilio = require('twilio');
const logger = require('../utils/logger');

let _client = null;

function getClient() {
  if (!_client) {
    const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN } = process.env;
    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required');
    }
    _client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }
  return _client;
}

/**
 * Normalize a phone number to E.164 format.
 * Assumes US numbers if no country code present.
 */
function toE164(phone) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('1') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

// ─── SMS ─────────────────────────────────────────────────────────────────────

/**
 * Send an SMS to a lead.
 *
 * @param {string} to      phone number (any format)
 * @param {string} body    message text
 * @returns {Promise<{ sid: string }>}
 */
async function sendSms(to, body) {
  const toNumber = toE164(to);
  if (!toNumber) throw new Error(`Invalid phone number: ${to}`);

  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) throw new Error('TWILIO_PHONE_NUMBER is required');

  const client = getClient();
  const message = await client.messages.create({ to: toNumber, from, body });

  logger.info('SMS sent', { to: toNumber, sid: message.sid });
  return { sid: message.sid };
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────

/**
 * Send a WhatsApp message via Twilio WhatsApp sandbox or Business API.
 *
 * @param {string} to      phone number (any format)
 * @param {string} body    message text (supports *bold* and line breaks)
 * @returns {Promise<{ sid: string }>}
 */
async function sendWhatsApp(to, body) {
  const toNumber = toE164(to);
  if (!toNumber) throw new Error(`Invalid phone number: ${to}`);

  const waFrom = process.env.TWILIO_WHATSAPP_NUMBER; // e.g. whatsapp:+14155238886
  if (!waFrom) throw new Error('TWILIO_WHATSAPP_NUMBER is required');

  const client = getClient();
  const message = await client.messages.create({
    to: `whatsapp:${toNumber}`,
    from: waFrom.startsWith('whatsapp:') ? waFrom : `whatsapp:${waFrom}`,
    body,
  });

  logger.info('WhatsApp sent', { to: toNumber, sid: message.sid });
  return { sid: message.sid };
}

module.exports = { sendSms, sendWhatsApp, toE164 };
