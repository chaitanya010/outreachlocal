'use strict';

/**
 * Free, zero-API-key email discovery: fetch a lead's web presence (real
 * website, or the social/directory profile URL preserved in social_url) and
 * regex-extract a contact email from the HTML. No paid enrichment API
 * required — this is tried first in enrichmentService before Hunter/Apollo.
 */

const axios = require('axios');
const logger = require('../utils/logger');

const client = axios.create({
  timeout: 8_000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StanWebBot/1.0; +https://stanweb.tech)' },
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
});

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Emails that are technically valid but never a real business contact.
const IGNORE_PATTERNS = [
  /\.(png|jpe?g|gif|svg|webp)$/i,
  /^(info|support)@(wixpress|godaddy|squarespace|weebly|shopify)\.com$/i,
  /@(sentry\.io|schema\.org|w3\.org|googleapis\.com|gstatic\.com|example\.com|domain\.com)$/i,
  /^(noreply|no-reply|donotreply)@/i,
];

function extractEmails(html) {
  if (!html) return [];
  const matches = html.match(EMAIL_RE) || [];
  const unique = [...new Set(matches.map((e) => e.toLowerCase()))];
  return unique.filter((email) => !IGNORE_PATTERNS.some((re) => re.test(email)));
}

async function fetchPage(url) {
  try {
    const { data, headers } = await client.get(url);
    if (typeof data !== 'string') return '';
    if (headers['content-type'] && !headers['content-type'].includes('html') && !headers['content-type'].includes('text')) return '';
    return data;
  } catch (err) {
    logger.debug('websiteEmailScraper: fetch failed', { url, message: err.message });
    return '';
  }
}

const SOCIAL_HOST_RE = /facebook\.com|instagram\.com|twitter\.com|x\.com|yelp\.com|tripadvisor\.com|linktr\.ee/i;

/**
 * Try to find a contact email by scraping a URL. Real business sites also
 * get their /contact, /contact-us, and /about pages checked; social/directory
 * profile URLs are only checked as-is (no guessing subpages that don't exist).
 *
 * @param {string} url
 * @returns {Promise<string|null>}
 */
async function scrapeEmailFromUrl(url) {
  if (!url) return null;

  let base;
  try {
    base = new URL(url);
  } catch {
    return null;
  }

  const pagesToTry = [url];
  if (!SOCIAL_HOST_RE.test(base.hostname)) {
    for (const path of ['/contact', '/contact-us', '/about']) {
      pagesToTry.push(`${base.protocol}//${base.host}${path}`);
    }
  }

  for (const pageUrl of pagesToTry) {
    const html = await fetchPage(pageUrl);
    const emails = extractEmails(html);
    if (emails.length) {
      logger.debug('websiteEmailScraper: found email', { pageUrl, email: emails[0] });
      return emails[0];
    }
  }

  return null;
}

module.exports = { scrapeEmailFromUrl, extractEmails };
