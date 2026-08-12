'use strict';

const { timezoneForCountry, isWithinBusinessHours } = require('../src/utils/timezone');

describe('timezoneForCountry', () => {
  test('maps known countries to their representative IANA timezone', () => {
    expect(timezoneForCountry('United States')).toBe('America/New_York');
    expect(timezoneForCountry('United Kingdom')).toBe('Europe/London');
    expect(timezoneForCountry('Australia')).toBe('Australia/Sydney');
    expect(timezoneForCountry('Canada')).toBe('America/Toronto');
    expect(timezoneForCountry('Ireland')).toBe('Europe/Dublin');
    expect(timezoneForCountry('New Zealand')).toBe('Pacific/Auckland');
  });

  test('falls back to the US timezone for unrecognized/missing country', () => {
    expect(timezoneForCountry('Narnia')).toBe('America/New_York');
    expect(timezoneForCountry(undefined)).toBe('America/New_York');
  });
});

describe('isWithinBusinessHours', () => {
  // Tuesday 2026-08-11 12:00:00 UTC -- a fixed instant so these assertions
  // don't depend on the real wall-clock time the suite happens to run at.
  const TUESDAY_NOON_UTC = new Date('2026-08-11T12:00:00Z');
  // Saturday 2026-08-15 12:00:00 UTC
  const SATURDAY_NOON_UTC = new Date('2026-08-15T12:00:00Z');

  test('true when local hour falls inside [start, end)', () => {
    // 12:00 UTC = 08:00 America/New_York (EDT, UTC-4) -- just before a 9-17 window
    expect(isWithinBusinessHours('United States', 9, 17, TUESDAY_NOON_UTC)).toBe(false);
    // 12:00 UTC = 13:00 Europe/London (BST, UTC+1) -- inside a 9-17 window
    expect(isWithinBusinessHours('United Kingdom', 9, 17, TUESDAY_NOON_UTC)).toBe(true);
  });

  test('false outside [start, end) local hours', () => {
    // 12:00 UTC = 22:00 Australia/Sydney (AEST, UTC+10) -- well outside 9-17
    expect(isWithinBusinessHours('Australia', 9, 17, TUESDAY_NOON_UTC)).toBe(false);
  });

  test('false on a Saturday/Sunday local to the country, even during work hours', () => {
    // Saturday everywhere in these timezones at this instant
    expect(isWithinBusinessHours('United States', 0, 24, SATURDAY_NOON_UTC)).toBe(false);
    expect(isWithinBusinessHours('United Kingdom', 0, 24, SATURDAY_NOON_UTC)).toBe(false);
  });

  test('unrecognized country falls back to US timezone rather than throwing', () => {
    expect(() => isWithinBusinessHours(undefined, 9, 17, TUESDAY_NOON_UTC)).not.toThrow();
    expect(() => isWithinBusinessHours('Nowhere', 9, 17, TUESDAY_NOON_UTC)).not.toThrow();
  });
});
