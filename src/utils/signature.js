'use strict';

/**
 * Plain-text signature block for outbound emails. No emojis, despite the
 * example format that inspired this having icon bullets -- the same brief
 * that asked for this signature also has a blanket "no emojis" rule, and
 * that global deliverability rule wins over the illustrative formatting.
 *
 * Link count is deliberately minimal (Calendly + the required unsubscribe
 * link, at most 2 total) -- real-world testing showed the original version
 * (website + Calendly + WhatsApp + LinkedIn, 4 distinct linked domains)
 * landed in Gmail's Promotions tab. Gmail's classifier weighs link count and
 * link-domain diversity heavily, and the original brief's own rule was
 * "one or two links maximum" -- website and LinkedIn are dropped, and
 * WhatsApp shows as a plain (non-hyperlinked) number instead of a wa.me URL.
 */

const NAME = process.env.SENDER_NAME || 'Chaitanya Kapre';
const TITLE = process.env.SENDER_TITLE || 'Founder | StanWeb';
const CALENDLY_URL = process.env.CALENDLY_URL || '';
const CONTACT_EMAIL = process.env.SES_FROM_EMAIL || 'contact@stanweb.tech';
const WHATSAPP_RAW = process.env.WHATSAPP_SIGNATURE_NUMBER || '';
const PHONE_NUMBER = process.env.SENDER_PHONE || '';

// Accepts either a raw number or a wa.me/https://wa.me/<number> link and
// always displays just the plain digits, so it never renders as a clickable
// URL (which would count against the link-count budget above).
function whatsappDisplayNumber(raw) {
  if (!raw) return '';
  const match = raw.match(/(\+?\d[\d\s-]{6,}\d)/);
  return match ? match[1].trim() : raw;
}

function buildSignature() {
  const lines = [NAME, TITLE, '', CONTACT_EMAIL];
  if (CALENDLY_URL) lines.push(`Book a call: ${CALENDLY_URL}`);
  const whatsapp = whatsappDisplayNumber(WHATSAPP_RAW);
  if (whatsapp) lines.push(`WhatsApp: ${whatsapp}`);
  if (PHONE_NUMBER) lines.push(`Phone: ${PHONE_NUMBER}`);
  return lines.join('\n');
}

module.exports = { buildSignature };
