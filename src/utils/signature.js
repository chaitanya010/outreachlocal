'use strict';

/**
 * Plain-text signature block for outbound emails. No emojis, despite the
 * example format that inspired this having icon bullets -- the same brief
 * that asked for this signature also has a blanket "no emojis" rule, and
 * that global deliverability rule wins over the illustrative formatting.
 *
 * Live isolation testing (real sends, checking inbox vs Promotions) found:
 *  - A version with 4 distinct linked domains (website/Calendly/WhatsApp/
 *    LinkedIn) landed in Promotions.
 *  - Trimming to 2 links (Calendly + the visible unsubscribe link) still
 *    landed in Promotions.
 *  - A single Calendly link, with everything else stripped (no unsubscribe
 *    link, no other contact links), STILL landed in Promotions.
 *  - A completely bare email (zero links, zero HTML, no product pitch,
 *    name-only sign-off) landed in the Inbox.
 * Conclusion: for this domain's current (brand-new, unwarmed) sending
 * reputation, ANY link at all triggers Promotions, not just link count.
 * Signature is zero-link by default until that changes. Calendly/WhatsApp/
 * phone/email stay available via env flags for whenever it's worth
 * re-testing (e.g. after real reply/engagement history builds up).
 */

const NAME = process.env.SENDER_NAME || 'Chaitanya Kapre';
const TITLE = process.env.SENDER_TITLE || 'Founder | StanWeb';
// Bare domain mention, not a hyperlink.
const BRAND_LINE = 'stanweb.tech';
const CALENDLY_URL = process.env.CALENDLY_URL || '';
const CONTACT_EMAIL = process.env.SES_FROM_EMAIL || 'contact@stanweb.tech';
const WHATSAPP_RAW = process.env.WHATSAPP_SIGNATURE_NUMBER || '';
const PHONE_NUMBER = process.env.SENDER_PHONE || '';

// Everything below is opt-in via env flags -- confirmed to trigger
// Promotions placement, so off by default. Contact details are reachable
// via Reply-To regardless of what's shown here.
const INCLUDE_CONTACT = process.env.SIGNATURE_INCLUDE_CONTACT === 'true';
const INCLUDE_CALENDLY = process.env.SIGNATURE_INCLUDE_CALENDLY === 'true';

// Accepts either a raw number or a wa.me/https://wa.me/<number> link and
// always displays just the plain digits, so it never renders as a clickable
// URL (which would count against the link-count budget above).
function whatsappDisplayNumber(raw) {
  if (!raw) return '';
  const match = raw.match(/(\+?\d[\d\s-]{6,}\d)/);
  return match ? match[1].trim() : raw;
}

function buildSignature() {
  const lines = [NAME, TITLE, BRAND_LINE];
  if (INCLUDE_CALENDLY && CALENDLY_URL) lines.push('', `Schedule a meeting with me: ${CALENDLY_URL}`);

  if (INCLUDE_CONTACT) {
    lines.push('', CONTACT_EMAIL);
    const whatsapp = whatsappDisplayNumber(WHATSAPP_RAW);
    if (whatsapp) lines.push(`WhatsApp: ${whatsapp}`);
    if (PHONE_NUMBER) lines.push(`Phone: ${PHONE_NUMBER}`);
  }

  return lines.join('\n');
}

module.exports = { buildSignature };
