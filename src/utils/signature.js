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
 *  - A completely bare email (zero links, zero HTML, no product pitch,
 *    name-only sign-off) landed in the Inbox.
 * Current signature is the bare-Inbox version plus exactly ONE link
 * (Calendly) -- the only link anywhere in the email now that the visible
 * unsubscribe text/link is also gone (opt-out still works via the
 * List-Unsubscribe header). This is a genuinely new configuration, not a
 * repeat of either failed version above.
 */

const NAME = process.env.SENDER_NAME || 'Chaitanya Kapre';
const TITLE = process.env.SENDER_TITLE || 'Founder | StanWeb';
// Bare domain mention, not a hyperlink.
const BRAND_LINE = 'stanweb.tech';
const CALENDLY_URL = process.env.CALENDLY_URL || '';
const CONTACT_EMAIL = process.env.SES_FROM_EMAIL || 'contact@stanweb.tech';
const WHATSAPP_RAW = process.env.WHATSAPP_SIGNATURE_NUMBER || '';
const PHONE_NUMBER = process.env.SENDER_PHONE || '';

// Email/WhatsApp/phone lines stay gated behind this (contact details are
// reachable via Reply-To regardless) -- only the Calendly line below is
// shown by default now.
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
  const lines = [NAME, TITLE, BRAND_LINE];
  if (CALENDLY_URL) lines.push('', `Schedule a meeting with me: ${CALENDLY_URL}`);

  if (INCLUDE_CONTACT) {
    lines.push('', CONTACT_EMAIL);
    const whatsapp = whatsappDisplayNumber(WHATSAPP_RAW);
    if (whatsapp) lines.push(`WhatsApp: ${whatsapp}`);
    if (PHONE_NUMBER) lines.push(`Phone: ${PHONE_NUMBER}`);
  }

  return lines.join('\n');
}

module.exports = { buildSignature };
