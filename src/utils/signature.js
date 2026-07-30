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
 * Follow-up round narrowed it further: even that bare-plain-text version
 * landed in Promotions once the body mentioned the company name or listed
 * services. The one email that reliably lands in the Inbox has NO company
 * name/title/brand anywhere and signs off with just a first name -- so
 * that's the default now. Full name/title/brand/Calendly/contact all stay
 * available via env flags for whenever it's worth re-testing (e.g. once
 * this address has some real reply/engagement history built up).
 */

const FULL_NAME = process.env.SENDER_NAME || 'Chaitanya Kapre';
const FIRST_NAME = FULL_NAME.split(/\s+/)[0];
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
const INCLUDE_BRAND = process.env.SIGNATURE_INCLUDE_BRAND === 'true';
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
  if (!INCLUDE_BRAND) return FIRST_NAME;

  const lines = [FULL_NAME, TITLE, BRAND_LINE];
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
