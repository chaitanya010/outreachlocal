'use strict';

/**
 * Plain-text signature block for outbound emails. No emojis, despite the
 * example format that inspired this having icon bullets -- the same brief
 * that asked for this signature also has a blanket "no emojis" rule, and
 * that global deliverability rule wins over the illustrative formatting.
 */

const NAME = process.env.SENDER_NAME || 'Chaitanya Kapre';
const TITLE = process.env.SENDER_TITLE || 'Founder | StanWeb';
const WEBSITE = process.env.SENDER_WEBSITE || 'https://stanweb.tech';
const CALENDLY_URL = process.env.CALENDLY_URL || '';
const CONTACT_EMAIL = process.env.SES_FROM_EMAIL || 'contact@stanweb.tech';
const WHATSAPP_NUMBER = process.env.WHATSAPP_SIGNATURE_NUMBER || '';
const PHONE_NUMBER = process.env.SENDER_PHONE || '';
const LINKEDIN_URL = process.env.SENDER_LINKEDIN || '';

function buildSignature() {
  const lines = [NAME, TITLE, '', WEBSITE];
  if (CALENDLY_URL) lines.push(CALENDLY_URL);
  lines.push(CONTACT_EMAIL);
  if (WHATSAPP_NUMBER) lines.push(`WhatsApp: ${WHATSAPP_NUMBER}`);
  if (PHONE_NUMBER) lines.push(`Phone: ${PHONE_NUMBER}`);
  if (LINKEDIN_URL) lines.push(LINKEDIN_URL);
  return lines.join('\n');
}

module.exports = { buildSignature };
