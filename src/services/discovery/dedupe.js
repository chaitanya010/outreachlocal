'use strict';

/**
 * Candidate-pool-level deduplication. Runs after all discovery sources are
 * merged (Google Places gives a place_id, Yelp/best-of-city candidates
 * don't), so identity has to be resolved across three signals: place_id,
 * normalized domain, and normalized name+city -- any one match is treated
 * as the same business. Drops anything already in `leads` too, so the
 * pipeline never re-discovers a business it has already contacted.
 */

function normalizeDomain(website) {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

function normalizeNameCity(name, city) {
  const norm = (s) =>
    (s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  return `${norm(name)}|${norm(city)}`;
}

/**
 * @param {object[]} candidates  raw merged candidates from all discovery sources
 * @param {object[]} existingLeads  rows from leadsRepository.getExistingLeadIdentifiers()
 * @returns {object[]} deduplicated candidates, each with a `domain` field attached
 */
function dedupeCandidates(candidates, existingLeads = []) {
  const existingPlaceIds = new Set(existingLeads.map((l) => l.place_id).filter(Boolean));
  const existingDomains = new Set(existingLeads.map((l) => normalizeDomain(l.domain || l.website)).filter(Boolean));
  const existingEmails = new Set(existingLeads.map((l) => (l.email || '').toLowerCase()).filter(Boolean));
  const existingNameCity = new Set(existingLeads.map((l) => normalizeNameCity(l.name, l.city)));

  const seenPlaceIds = new Set();
  const seenDomains = new Set();
  const seenNameCity = new Set();
  const result = [];

  for (const c of candidates) {
    const domain = normalizeDomain(c.website);
    const nameCity = normalizeNameCity(c.name, c.city);

    if (c.place_id && existingPlaceIds.has(c.place_id)) continue;
    if (domain && existingDomains.has(domain)) continue;
    if (c.email && existingEmails.has(c.email.toLowerCase())) continue;
    if (existingNameCity.has(nameCity)) continue;

    if (c.place_id && seenPlaceIds.has(c.place_id)) continue;
    if (domain && seenDomains.has(domain)) continue;
    if (seenNameCity.has(nameCity)) continue;

    if (c.place_id) seenPlaceIds.add(c.place_id);
    if (domain) seenDomains.add(domain);
    seenNameCity.add(nameCity);

    result.push({ ...c, domain });
  }

  return result;
}

module.exports = { dedupeCandidates, normalizeDomain, normalizeNameCity };
