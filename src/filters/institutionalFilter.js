'use strict';

/**
 * Screens out leads that aren't actually the kind of small local business
 * this outreach targets, even though they matched a Places search term and
 * technically have "no website" + a scraped email. Caught via a real
 * production example: a "mental health" search returned the NY State
 * Office of Mental Health, whose email is a .gov address belonging to a
 * state employee, not a business owner deciding whether to buy a website.
 * Cold-emailing that kind of address is pointless at best and looks like
 * spam to an institution at worst — screen it out structurally rather than
 * relying on the search term alone to avoid it.
 */

// TLDs that only belong to government, military, or institutional bodies —
// never a real local small business's contact address.
const INSTITUTIONAL_TLDS = new Set(['gov', 'mil']);

// Words that show up in government/institutional/nonprofit-advocacy org
// names but essentially never in a local small business's name — e.g. a
// ".org" nonprofit advocacy group ("Mental Health Association of NY") isn't
// a .gov, but is exactly as pointless a cold-email target as one.
const INSTITUTIONAL_NAME_RE =
  /\b(department|division|bureau|agency|county|city of|town of|state of|municipal|municipality|courthouse|court|commission|authority|office of|board of|federal|public health department|police department|fire department|dept\.?|association|coalition|foundation|institute|society|alliance|federation|nonprofit|non-profit|council|committee|task force)\b/i;

function isInstitutionalEmail(email) {
  if (!email) return false;
  const tld = email.split('.').pop().toLowerCase();
  return INSTITUTIONAL_TLDS.has(tld);
}

function isInstitutionalName(name) {
  return INSTITUTIONAL_NAME_RE.test(name || '');
}

/**
 * True if this lead looks like a real small local business worth pitching,
 * false if it looks like a government/institutional entity that slipped
 * through the Places search.
 */
function isLikelyRealBusiness(lead) {
  if (isInstitutionalEmail(lead.email)) return false;
  if (isInstitutionalName(lead.name)) return false;
  return true;
}

module.exports = { isLikelyRealBusiness, isInstitutionalEmail, isInstitutionalName };
