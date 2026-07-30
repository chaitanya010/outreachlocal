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

// Allowlist of real TLDs, rather than blacklisting fake ones — file names
// embedded in a page (e.g. "report-2026-final.apr") can look exactly like an
// email to EMAIL_RE since any 2+ letter suffix passes as a "TLD"; blocking
// them one extension at a time is whack-a-mole. Curated for US local
// business email domains (.com/.org/.net/.us/.gov/.edu, common alternates).
const VALID_TLDS = new Set([
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'us', 'co', 'io', 'info', 'biz', 'me', 'name', 'pro',
]);

// Emails that are technically valid, real-TLD addresses but never a real
// business contact: analytics/error-tracking pixels, third-party
// directories/listing aggregators, and booking-platform support addresses
// that show up embedded in or linked from a business's page.
const IGNORE_PATTERNS = [
  // Platform/template system addresses
  /^(info|support)@(wixpress|godaddy|squarespace|weebly|shopify)\.com$/i,
  /@(schema\.org|w3\.org|googleapis\.com|gstatic\.com|example\.com|domain\.com|mystore\.com|mysite\.com)$/i,
  // Placeholder/template dummy values ("you@email.com", "your@domain.com", etc.)
  /^(you|your|name|user|test|username)@(email|domain|mail|yourdomain)\.com$/i,
  // Med-spa/local-business website & SEO platform vendors -- their agency
  // login/admin address embedded in the page, not the business's own contact
  /@(growth99|patientnow|weomedia)\.com$/i,
  // Sentry error-tracking DSNs embedded in page JS — <hash>@sentry.io or
  // <hash>@<project-id>.ingest.<region>.sentry.io — not an email
  /@([a-z0-9-]+\.)*sentry\.io$/i,
  /^(noreply|no-reply|donotreply)@/i,
  // Search engines / social platforms (support inboxes, not the business)
  /@(duckduckgo|google|bing|yahoo|facebook|instagram)\.com$/i,
  // Directories, listing aggregators, and third-party booking-widget vendors
  // that commonly get embedded in or linked from a business's own page
  /@(mapquest|superpages|yellowpages|manta|angieslist|thumbtack|chamberofcommerce|bbb)\.(com|org)$/i,
  /@(massagebook|booksy|schedulicity|vagaro|mindbodyonline|glossgenius|fresha|styleseat|square|squareup|calendly|acuityscheduling|giftly|gift(up|card)|toasttab)\.com$/i,
];

function extractEmails(html) {
  if (!html) return [];
  const matches = html.match(EMAIL_RE) || [];
  const unique = [...new Set(matches.map((e) => e.toLowerCase()))];
  return unique.filter((email) => {
    const tld = email.split('.').pop();
    if (!VALID_TLDS.has(tld)) return false;
    return !IGNORE_PATTERNS.some((re) => re.test(email));
  });
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
 * @param {(html: string) => boolean} [verifyHtml]  optional page-content check —
 *   e.g. confirm the business's own name shows up before trusting an email
 *   found on it. Only used for the web-search path, where the URL itself is
 *   an unverified guess; a known website/social_url from our own data
 *   doesn't need this.
 * @returns {Promise<string|null>}
 */
async function scrapeEmailFromUrl(url, verifyHtml) {
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
    if (verifyHtml && !verifyHtml(html)) continue;
    const emails = extractEmails(html);
    if (emails.length) {
      logger.debug('websiteEmailScraper: found email', { pageUrl, email: emails[0] });
      return emails[0];
    }
  }

  return null;
}

// Words too generic to prove a page belongs to a specific business (nearly
// every local-business page contains some of these).
const GENERIC_NAME_WORDS = new Set([
  'the', 'and', 'inc', 'llc', 'corp', 'co', 'spa', 'salon', 'center', 'centre',
  'clinic', 'studio', 'medical', 'wellness', 'health', 'healthcare', 'massage',
  'nails', 'nail', 'beauty', 'shop', 'shoppe', 'group', 'associates',
  'services', 'service', 'of', 'for', 'at', 'new', 'york', 'nyc',
]);

function distinctiveNameWords(name) {
  return (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !GENERIC_NAME_WORDS.has(w));
}

/**
 * Sanity check that a scraped page is actually about this business — catches
 * a search result that ranked for the query but is really some unrelated
 * organization's page. Requires at least 2 distinctive name words on the
 * page (or the ONE available word if the name genuinely has only one).
 * A single generic-ish word ("testing" from "Medical Testing Center") isn't
 * enough evidence — for names with too little distinctive signal to check,
 * this rejects rather than risks emailing the wrong organization.
 */
function pageMatchesBusiness(html, name) {
  const words = distinctiveNameWords(name);
  if (words.length === 0) return false;
  const lower = (html || '').toLowerCase();
  const matchCount = words.filter((w) => lower.includes(w)).length;
  const required = words.length === 1 ? 1 : 2;
  return matchCount >= required;
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
 * Raw Serper.dev search — the full response JSON (organic results, and for
 * local-intent queries like "best plumbers in Austin", a `places` array
 * mirroring Google's local pack). Used by both searchViaSerper (email
 * discovery) and discovery/bestOfCitySource.js (business discovery).
 * Returns null if SERPER_API_KEY isn't configured or the request failed.
 */
async function serperSearch(query) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await client.post(
      'https://google.serper.dev/search',
      { q: query },
      { headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' } }
    );
    return data;
  } catch (err) {
    logger.warn('websiteEmailScraper: Serper search failed', { query, message: err.message });
    return null;
  }
}

/**
 * Real search via Serper.dev (Google results as JSON, no scraping/CAPTCHA
 * involved) — used when SERPER_API_KEY is configured. Returns an array of
 * result URLs, or null if not configured / the request failed.
 */
async function searchViaSerper(query) {
  const data = await serperSearch(query);
  if (!data) return null;
  const organic = data.organic || [];
  return organic.map((r) => r.link).filter(Boolean);
}

/**
 * DuckDuckGo's public HTML search — no API key needed, but DDG serves an
 * anti-bot CAPTCHA challenge to most automated requests, so this frequently
 * finds nothing. Kept only as a last-resort fallback when Serper isn't
 * configured; never trusted if it comes back as the challenge page itself.
 */
async function searchViaDuckDuckGo(query) {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchPage(searchUrl);
  if (!html) return null;

  if (html.includes('anomaly-modal') || html.includes('challenge-form')) {
    logger.warn('websiteEmailScraper: DuckDuckGo served a bot-check page, skipping', { query });
    return null;
  }

  return extractSearchResultUrls(html);
}

/**
 * Last resort when a lead has no known website or social_url at all: search
 * the open web for "<business name> <city>" and scrape the top few results
 * for a contact email. Prefers Serper (reliable, real search API) when
 * SERPER_API_KEY is set; falls back to scraping DuckDuckGo's HTML (frequently
 * blocked, best-effort only) when it isn't.
 *
 * @param {string} name
 * @param {string} city
 * @returns {Promise<string|null>}
 */
async function searchWebForEmail(name, city) {
  if (!name) return null;

  const query = `${name} ${city || ''}`.trim();
  const urls = (await searchViaSerper(query)) ?? (await searchViaDuckDuckGo(query));
  if (!urls) return null;

  const verify = (html) => pageMatchesBusiness(html, name);

  for (const url of urls.slice(0, MAX_RESULTS_TO_TRY)) {
    const email = await scrapeEmailFromUrl(url, verify);
    if (email) {
      logger.debug('websiteEmailScraper: found via web search', { name, city, url, email });
      return email;
    }
  }

  return null;
}

// ─── Discovery pipeline: decision-maker contact extraction ────────────────────
//
// Used by the new discovery pipeline (leadScorer/discoveryPipeline), not by
// the existing enrichmentService backfill path -- kept additive so nothing
// about today's enrichment behavior changes.

const TEAM_PATHS = ['/team', '/our-team', '/meet-the-team', '/staff', '/about-us', '/doctors', '/providers'];

const GENERIC_LOCAL_PARTS =
  /^(info|contact|hello|office|admin|support|frontdesk|front-desk|reception|team|sales|bookings?|appointments?|help|service|hi)$/i;

/**
 * "high" = looks like a real person's mailbox (firstname@, firstname.lastname@),
 * "medium" = generic role-based inbox (info@, contact@, etc) -- still a
 * legitimate send target per the "owner email OR general business email" spec,
 * just lower confidence it reaches a specific decision maker.
 */
function classifyEmailConfidence(email) {
  if (!email) return null;
  const local = email.split('@')[0];
  if (GENERIC_LOCAL_PARTS.test(local)) return 'medium';
  if (/^[a-z]+(\.[a-z]+)?[0-9]*$/i.test(local)) return 'high';
  return 'medium';
}

/**
 * Best-effort parse of schema.org JSON-LD blocks for an email and/or a
 * founder/employee name -- real structured data when a site has it, not a
 * guess.
 */
function extractFromSchemaOrg(html) {
  if (!html) return null;
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(parsed) ? parsed : [parsed];

    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const email = typeof node.email === 'string' ? node.email : null;
      const person = node.founder || node.employee;
      const personNode = Array.isArray(person) ? person[0] : person;
      const name = personNode?.name || null;
      const role = node.founder ? 'Founder' : personNode ? 'Employee' : null;
      if (email || name) return { email, name, role };
    }
  }
  return null;
}

const ROLE_WORDS = 'Owner|Founder|Practice Manager|Office Manager|General Manager|Manager';
const DECISION_MAKER_RE_A = new RegExp(`(?:${ROLE_WORDS})[:\\-–]?\\s+((?:Dr\\.\\s*)?[A-Z][a-zA-Z'-]+\\s[A-Z][a-zA-Z'-]+)`);
const DECISION_MAKER_RE_B = new RegExp(`((?:Dr\\.\\s*)?[A-Z][a-zA-Z'-]+\\s[A-Z][a-zA-Z'-]+)[,\\-–]\\s*(${ROLE_WORDS})`);

/**
 * Lightweight regex heuristic over raw page text -- looks for "Owner: Jane
 * Smith" / "Jane Smith, Founder" style patterns near team/about page
 * content. Best-effort; a miss just means no name, not a wrong answer.
 */
function extractDecisionMaker(html) {
  if (!html) return null;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  const matchA = text.match(DECISION_MAKER_RE_A);
  if (matchA) return { name: matchA[1], role: matchA[0].split(/[:\-–]/)[0].trim() };

  const matchB = text.match(DECISION_MAKER_RE_B);
  if (matchB) return { name: matchB[1], role: matchB[2] };

  return null;
}

function pickBestEmail(emails, decisionMakerName) {
  if (decisionMakerName) {
    const first = decisionMakerName.toLowerCase().replace(/^dr\.\s*/, '').split(/\s+/)[0];
    const match = emails.find((e) => e.split('@')[0].toLowerCase().includes(first));
    if (match) return match;
  }
  const personal = emails.find((e) => classifyEmailConfidence(e) === 'high');
  return personal || emails[0];
}

/**
 * Richer contact discovery for the daily discovery pipeline: crawls contact
 * + team/staff/about-us pages, cross-checks schema.org structured data,
 * extracts a decision-maker name/role where findable, and returns a
 * confidence-scored result instead of a bare email string.
 *
 * @param {string} baseUrl        candidate's website or social_url
 * @param {object} [opts]
 * @param {string} [opts.baseHtml]  HTML already fetched for baseUrl (e.g. by
 *   websiteAnalyzer) -- reused instead of fetching baseUrl a second time.
 * @param {(html: string) => boolean} [opts.verify]  page-verification callback
 * @returns {Promise<{ email: string, confidence: string, decisionMakerName: string|null, decisionMakerRole: string|null, sourcePage: string } | null>}
 */
async function crawlForContact(baseUrl, { baseHtml, verify } = {}) {
  if (!baseUrl) return null;

  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }

  const pagesToTry = [baseUrl];
  if (!SOCIAL_HOST_RE.test(base.hostname)) {
    for (const path of ['/contact', '/contact-us', '/about', ...TEAM_PATHS]) {
      pagesToTry.push(`${base.protocol}//${base.host}${path}`);
    }
  }

  for (const pageUrl of pagesToTry) {
    const html = pageUrl === baseUrl && baseHtml ? baseHtml : await fetchPage(pageUrl);
    if (!html) continue;
    if (verify && !verify(html)) continue;

    const emails = extractEmails(html);
    if (!emails.length) continue;

    const schemaContact = extractFromSchemaOrg(html);
    const decisionMaker = extractDecisionMaker(html) || schemaContact;
    const best = pickBestEmail(emails, decisionMaker?.name);

    return {
      email: best,
      confidence: classifyEmailConfidence(best),
      decisionMakerName: decisionMaker?.name || null,
      decisionMakerRole: decisionMaker?.role || null,
      sourcePage: pageUrl,
    };
  }

  return null;
}

/**
 * Same web-search fallback as searchWebForEmail, but returns the richer
 * crawlForContact result (confidence + decision-maker) instead of a bare
 * email string. Used by the discovery pipeline for candidates with no known
 * website/social_url at all (mainly Yelp-sourced candidates).
 */
async function discoverContactViaWebSearch(name, city) {
  if (!name) return null;

  const query = `${name} ${city || ''}`.trim();
  const urls = (await searchViaSerper(query)) ?? (await searchViaDuckDuckGo(query));
  if (!urls) return null;

  const verify = (html) => pageMatchesBusiness(html, name);

  for (const url of urls.slice(0, MAX_RESULTS_TO_TRY)) {
    const result = await crawlForContact(url, { verify });
    if (result) return result;
  }

  return null;
}

module.exports = {
  scrapeEmailFromUrl,
  searchWebForEmail,
  extractEmails,
  crawlForContact,
  discoverContactViaWebSearch,
  classifyEmailConfidence,
  extractDecisionMaker,
  extractFromSchemaOrg,
  searchViaSerper,
  serperSearch,
};
