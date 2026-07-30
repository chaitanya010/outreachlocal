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
  /@(duckduckgo|google|bing|yahoo|facebook|instagram)\.com$/i,
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

// ─── Web search fallback (no website/social_url on file at all) ──────────────

const SEARCH_RESULT_RE = /class="result__a"[^>]*href="([^"]+)"/g;
const MAX_RESULTS_TO_TRY = 3;

/**
 * Pull real target URLs out of a DuckDuckGo HTML search results page.
 * DDG's no-JS HTML endpoint wraps each result in a redirect
 * (//duckduckgo.com/l/?uddg=<encoded-real-url>&...) — unwrap that to get the
 * actual site.
 */
function extractSearchResultUrls(html) {
  const urls = [];
  let match;
  while ((match = SEARCH_RESULT_RE.exec(html))) {
    let href = match[1];
    try {
      if (href.includes('uddg=')) {
        const wrapper = new URL(href, 'https://duckduckgo.com');
        const real = wrapper.searchParams.get('uddg');
        if (real) href = real;
      }
      const parsed = new URL(href);
      if (!/(^|\.)duckduckgo\.com$/i.test(parsed.hostname)) urls.push(href);
    } catch {
      // malformed href, skip
    }
  }
  return [...new Set(urls)];
}

/**
 * Last resort when a lead has no known website or social_url at all: search
 * the open web for "<business name> <city>" and scrape the top few results
 * for a contact email. No search API key required (DuckDuckGo's public HTML
 * endpoint), no Google Places involved.
 *
 * @param {string} name
 * @param {string} city
 * @returns {Promise<string|null>}
 */
async function searchWebForEmail(name, city) {
  if (!name) return null;

  const query = `${name} ${city || ''}`.trim();
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchPage(searchUrl);
  if (!html) return null;

  // DDG serves an anti-bot CAPTCHA page for automated requests instead of
  // real results — detect it and bail rather than trust anything scraped
  // from that page (it isn't search results, and this isn't a challenge
  // we're going to try to solve).
  if (html.includes('anomaly-modal') || html.includes('challenge-form')) {
    logger.warn('websiteEmailScraper: DuckDuckGo served a bot-check page, skipping', { name, city });
    return null;
  }

  const candidates = extractSearchResultUrls(html).slice(0, MAX_RESULTS_TO_TRY);
  for (const url of candidates) {
    const email = await scrapeEmailFromUrl(url);
    if (email) {
      logger.debug('websiteEmailScraper: found via web search', { name, city, url, email });
      return email;
    }
  }

  return null;
}

module.exports = { scrapeEmailFromUrl, searchWebForEmail, extractEmails };
