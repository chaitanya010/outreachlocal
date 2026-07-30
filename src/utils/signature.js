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

// Deliverability isolation testing found the fuller signature (email +
// Calendly link + WhatsApp) landing in Gmail's Promotions tab even after
// trimming to 1-2 links. Defaults to name/title only -- the barest possible
// signature -- while this gets tested; contact details are still reachable
// via Reply-To (set on every send regardless of signature content), so
// nothing about replying is actually broken by omitting them here. Set
// SIGNATURE_INCLUDE_CONTACT=true to bring the contact lines back once
// inbox-vs-promotions placement is confirmed either way.
const INCLUDE_CONTACT = process.env.SIGNATURE_INCLUDE_CONTACT === 'true';

// Accepts either a raw number or a wa.me/https://wa.me/<number> link and
// always displays just the plain digits, so it never renders as a clickable
// URL (which would count against the link-count budget above).
function whatsappDisplayNumber(raw) {
  if (!raw) return '';
  const match = raw.match(/(\+?\d[\d\s-]{6,}\d)/);
  return match ? match[1].trim() : raw;
}

function buildSignature() {
  const lines = [NAME, TITLE];
  if (!INCLUDE_CONTACT) return lines.join('\n');

  lines.push('', CONTACT_EMAIL);
  if (CALENDLY_URL) lines.push(`Book a call: ${CALENDLY_URL}`);
  const whatsapp = whatsappDisplayNumber(WHATSAPP_RAW);
  if (whatsapp) lines.push(`WhatsApp: ${whatsapp}`);
  if (PHONE_NUMBER) lines.push(`Phone: ${PHONE_NUMBER}`);
  return lines.join('\n');
}

module.exports = { buildSignature };
