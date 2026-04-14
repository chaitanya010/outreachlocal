/**
 * websiteFilter.js
 *
 * Determines whether a lead should be included based on website presence.
 * A business is a "no-website lead" if it has no website at all, or if the
 * website field contains only a placeholder / social profile (not a real domain).
 */

// These patterns indicate a business "website" that isn't actually their own domain
const INVALID_WEBSITE_PATTERNS = [
  /^https?:\/\/(www\.)?(facebook|fb)\.com/i,
  /^https?:\/\/(www\.)?instagram\.com/i,
  /^https?:\/\/(www\.)?twitter\.com/i,
  /^https?:\/\/(www\.)?yelp\.com/i,
  /^https?:\/\/(www\.)?tripadvisor\.com/i,
  /^https?:\/\/(www\.)?google\.com/i,
  /^https?:\/\/(www\.)?maps\.google/i,
  /^https?:\/\/(www\.)?goo\.gl/i,
  /^https?:\/\/(www\.)?linktr\.ee/i,
];

/**
 * Returns true if the website URL is effectively "no website"
 * (missing, empty, or just a social/directory profile).
 *
 * @param {string|null} website
 * @returns {boolean}
 */
function isInvalidWebsite(website) {
  if (!website || typeof website !== 'string') return true;

  const trimmed = website.trim();
  if (!trimmed) return true;

  return INVALID_WEBSITE_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Filter an array of normalized leads to only those without a real website.
 *
 * @param {object[]} leads
 * @returns {object[]}
 */
function filterNoWebsite(leads) {
  return leads.filter((lead) => isInvalidWebsite(lead.website));
}

/**
 * Annotate each lead with corrected has_website based on our stricter check.
 * Mutates each lead in-place and returns the same array.
 *
 * @param {object[]} leads
 * @returns {object[]}
 */
function annotateWebsiteStatus(leads) {
  for (const lead of leads) {
    lead.has_website = !isInvalidWebsite(lead.website);
    // Null out social-profile "websites" so the field is clean in DB
    if (lead.website && isInvalidWebsite(lead.website)) {
      lead.website = null;
    }
  }
  return leads;
}

module.exports = { filterNoWebsite, annotateWebsiteStatus, isInvalidWebsite };
