'use strict';

/**
 * Site-quality signal extraction, fetched once per candidate and shared with
 * emailExtractor.js (which used to fetch the same page a second time) --
 * both websiteAnalyzer and emailExtractor should be called with the same
 * pre-fetched HTML from fetchAndAnalyze(), not re-fetch independently.
 */

const axios = require('axios');
const logger = require('../utils/logger');

const client = axios.create({
  timeout: 8_000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StanWebBot/1.0; +https://stanweb.tech)' },
  maxRedirects: 5,
  validateStatus: (status) => status < 500,
});

const BOOKING_WIDGET_RE =
  /massagebook|booksy|schedulicity|vagaro|mindbodyonline|glossgenius|fresha|styleseat|calendly|acuityscheduling|setmore|simplybook|appointy|genbook|squareup\.com\/appointments/i;

const CHAT_WIDGET_RE =
  /widget\.intercom\.io|js\.driftt\.com|embed\.tawk\.to|widget-mediator\.zopim|static\.zdassets\.com|client\.crisp\.chat|widget-v4\.tidiochat\.com|js\.hs-scripts\.com|connect\.facebook\.net\/[^"']*\/sdk\/xfbml\.customerchat/i;

const WORDPRESS_RE = /wp-content|wp-includes|<meta[^>]+generator[^>]+wordpress/i;

/**
 * Pure function over already-fetched HTML -- kept separate from the network
 * call so it's independently unit-testable against fixture HTML.
 */
function analyzeHtml({ html, url, responseTimeMs }) {
  let isHttps = false;
  try {
    isHttps = new URL(url).protocol === 'https:';
  } catch {
    // leave false
  }

  const lower = html || '';
  return {
    https: isHttps,
    mobileResponsive: /<meta[^>]+name=["']viewport["']/i.test(lower),
    hasBookingWidget: BOOKING_WIDGET_RE.test(lower),
    hasChatWidget: CHAT_WIDGET_RE.test(lower),
    isWordpress: WORDPRESS_RE.test(lower),
    hasFacebookLink: /facebook\.com\//i.test(lower),
    hasInstagramLink: /instagram\.com\//i.test(lower),
    responseTimeMs: responseTimeMs ?? null,
  };
}

/**
 * Fetches the site once and returns both the raw HTML (for emailExtractor to
 * reuse) and the derived quality signals.
 *
 * @param {string} url
 * @returns {Promise<{ html: string, signals: object } | null>} null if the fetch failed
 */
async function fetchAndAnalyze(url) {
  if (!url) return null;

  const started = Date.now();
  try {
    const { data, headers } = await client.get(url);
    const responseTimeMs = Date.now() - started;

    if (typeof data !== 'string') return null;
    if (headers['content-type'] && !headers['content-type'].includes('html') && !headers['content-type'].includes('text')) {
      return null;
    }

    return { html: data, signals: analyzeHtml({ html: data, url, responseTimeMs }) };
  } catch (err) {
    logger.debug('websiteAnalyzer: fetch failed', { url, message: err.message });
    return null;
  }
}

module.exports = { fetchAndAnalyze, analyzeHtml };
