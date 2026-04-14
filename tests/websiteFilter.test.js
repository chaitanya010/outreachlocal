const {
  isInvalidWebsite,
  filterNoWebsite,
  annotateWebsiteStatus,
} = require('../src/filters/websiteFilter');

describe('isInvalidWebsite', () => {
  test('returns true for null', () => expect(isInvalidWebsite(null)).toBe(true));
  test('returns true for empty string', () => expect(isInvalidWebsite('')).toBe(true));
  test('returns true for whitespace', () => expect(isInvalidWebsite('  ')).toBe(true));

  test('returns true for Facebook URL', () =>
    expect(isInvalidWebsite('https://www.facebook.com/myshop')).toBe(true));
  test('returns true for Instagram URL', () =>
    expect(isInvalidWebsite('https://instagram.com/myshop')).toBe(true));
  test('returns true for Yelp URL', () =>
    expect(isInvalidWebsite('https://yelp.com/biz/myshop')).toBe(true));
  test('returns true for Google Maps URL', () =>
    expect(isInvalidWebsite('https://maps.google.com/?q=myshop')).toBe(true));

  test('returns false for a real domain', () =>
    expect(isInvalidWebsite('https://myspa.com')).toBe(false));
  test('returns false for www domain', () =>
    expect(isInvalidWebsite('https://www.luxuryspa.co')).toBe(false));
});

describe('filterNoWebsite', () => {
  const leads = [
    { name: 'A', website: null, has_website: false },
    { name: 'B', website: 'https://bspa.com', has_website: true },
    { name: 'C', website: 'https://facebook.com/cspa', has_website: true },
    { name: 'D', website: 'https://dspa.com', has_website: true },
  ];

  test('keeps only leads without a real website', () => {
    const result = filterNoWebsite(leads);
    expect(result.map((l) => l.name)).toEqual(['A', 'C']);
  });
});

describe('annotateWebsiteStatus', () => {
  test('corrects has_website and nulls out social URLs', () => {
    const leads = [
      { name: 'A', website: 'https://facebook.com/a', has_website: true },
      { name: 'B', website: 'https://bspa.com', has_website: false },
    ];

    annotateWebsiteStatus(leads);

    expect(leads[0].has_website).toBe(false);
    expect(leads[0].website).toBe(null);

    expect(leads[1].has_website).toBe(true);
    expect(leads[1].website).toBe('https://bspa.com');
  });
});
