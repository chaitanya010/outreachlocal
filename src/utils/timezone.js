'use strict';

/**
 * Per-country timezone lookup for gating outbound sends to a lead's local
 * business hours. Emailing at 9am-5pm New York time meant an Australian
 * lead was landing in their inbox at 11pm-7am -- a bad time for a cold open
 * to arrive, and a likely contributor to lower reply rates from that market
 * (see emailSequence.js's isWithinBusinessHours usage). One representative
 * timezone per country, same simplification already implicitly made for the
 * US (which spans several timezones but has always used a single
 * America/New_York window) -- good enough for a coarse "is it a reasonable
 * hour there" check, not meant to be minute-perfect per city.
 */

const TIMEZONE_BY_COUNTRY = {
  'United States': 'America/New_York',
  'United Kingdom': 'Europe/London',
  'Australia': 'Australia/Sydney',
  'Canada': 'America/Toronto',
  'Ireland': 'Europe/Dublin',
  'New Zealand': 'Pacific/Auckland',
};

function timezoneForCountry(country) {
  return TIMEZONE_BY_COUNTRY[country] || TIMEZONE_BY_COUNTRY['United States'];
}

/** Current local hour (0-23) in the given IANA timezone. */
function localHour(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  return parseInt(parts.find((p) => p.type === 'hour').value, 10);
}

const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Current local day of week (0=Sun..6=Sat, matching Date#getDay()) in the given IANA timezone. */
function localWeekday(timezone, now = new Date()) {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(now);
  return WEEKDAY_INDEX[short];
}

/**
 * Whether it's currently within [startHour, endHour) local time, Mon-Fri,
 * for the given lead's country. `country` is matched against
 * TIMEZONE_BY_COUNTRY; anything unrecognized (null, legacy leads predating
 * this column, a typo) falls back to the US timezone rather than throwing,
 * since that's the majority of the existing lead base and the previous
 * (implicit) behavior.
 */
function isWithinBusinessHours(country, startHour, endHour, now = new Date()) {
  const timezone = timezoneForCountry(country);
  const weekday = localWeekday(timezone, now);
  if (weekday === 0 || weekday === 6) return false; // Sat/Sun, local to the lead
  const hour = localHour(timezone, now);
  return hour >= startHour && hour < endHour;
}

module.exports = { TIMEZONE_BY_COUNTRY, timezoneForCountry, localHour, localWeekday, isWithinBusinessHours };
