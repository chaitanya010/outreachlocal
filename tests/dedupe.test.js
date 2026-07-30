const { dedupeCandidates, normalizeDomain, normalizeNameCity } = require('../src/services/discovery/dedupe');

describe('normalizeDomain', () => {
  test('strips protocol and www', () => {
    expect(normalizeDomain('https://www.myspa.com/contact')).toBe('myspa.com');
  });
  test('returns null for missing/invalid url', () => {
    expect(normalizeDomain(null)).toBe(null);
    expect(normalizeDomain('not a url')).toBe(null);
  });
});

describe('dedupeCandidates', () => {
  test('collapses duplicate place_id within the same batch', () => {
    const candidates = [
      { place_id: 'p1', name: 'A Spa', city: 'Miami', website: null },
      { place_id: 'p1', name: 'A Spa', city: 'Miami', website: null },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(1);
  });

  test('collapses duplicate domain across sources with different place_ids', () => {
    const candidates = [
      { place_id: 'google:1', name: 'A Spa', city: 'Miami', website: 'https://aspa.com' },
      { place_id: 'yelp:2', name: 'A Spa Miami', city: 'Miami', website: 'https://www.aspa.com/' },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(1);
  });

  test('collapses duplicate normalized name+city with no website at all', () => {
    const candidates = [
      { place_id: 'google:1', name: 'Bright Nails', city: 'Austin', website: null },
      { place_id: null, name: 'Bright Nails!', city: 'Austin', website: null },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(1);
  });

  test('keeps genuinely distinct businesses', () => {
    const candidates = [
      { place_id: 'p1', name: 'A Spa', city: 'Miami', website: 'https://aspa.com' },
      { place_id: 'p2', name: 'B Spa', city: 'Austin', website: 'https://bspa.com' },
    ];
    expect(dedupeCandidates(candidates)).toHaveLength(2);
  });

  test('drops candidates already present in existing leads by place_id, domain, email, or name+city', () => {
    const existing = [
      { place_id: 'p1', domain: null, website: null, email: null, name: 'X', city: 'Y' },
      { place_id: 'p2', domain: 'known.com', website: null, email: null, name: 'Known Biz', city: 'Dallas' },
      { place_id: 'p3', domain: null, website: null, email: 'owner@z.com', name: 'Z', city: 'W' },
    ];
    const candidates = [
      { place_id: 'p1', name: 'New Name', city: 'New City', website: null },
      { place_id: 'other', name: 'Known Biz', city: 'Dallas', website: 'https://known.com' },
      { place_id: 'other2', name: 'Different', city: 'Different', website: null, email: 'owner@z.com' },
      { place_id: 'fresh', name: 'Fresh Biz', city: 'Fresno', website: 'https://freshbiz.com' },
    ];

    const result = dedupeCandidates(candidates, existing);
    expect(result.map((c) => c.place_id)).toEqual(['fresh']);
  });

  test('attaches a normalized domain field to surviving candidates', () => {
    const result = dedupeCandidates([{ place_id: 'p1', name: 'A', city: 'B', website: 'https://www.abc.com' }]);
    expect(result[0].domain).toBe('abc.com');
  });
});

describe('normalizeNameCity', () => {
  test('is case- and punctuation-insensitive', () => {
    expect(normalizeNameCity('Bright Nails!', 'Austin')).toBe(normalizeNameCity('bright nails', 'AUSTIN'));
  });
});
