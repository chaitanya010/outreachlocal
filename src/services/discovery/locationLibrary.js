'use strict';

/**
 * Curated list of mid/large US cities used for geographic rotation.
 *
 * Google Places Text Search operates at city granularity (a "state > county
 * > city > ZIP" random-walk, as originally requested, isn't something the
 * API can usefully target — ZIP-level text search just re-finds the same
 * city's results). So rotation here is state -> city: enough spread across
 * all 50 states to avoid over-mining any one metro, while staying at a
 * granularity the discovery sources can actually query.
 */

const CITIES = [
  { city: 'New York', state: 'NY' }, { city: 'Buffalo', state: 'NY' }, { city: 'Rochester', state: 'NY' },
  { city: 'Los Angeles', state: 'CA' }, { city: 'San Diego', state: 'CA' }, { city: 'San Francisco', state: 'CA' },
  { city: 'Sacramento', state: 'CA' }, { city: 'Fresno', state: 'CA' }, { city: 'Oakland', state: 'CA' },
  { city: 'Chicago', state: 'IL' }, { city: 'Aurora', state: 'IL' }, { city: 'Naperville', state: 'IL' },
  { city: 'Houston', state: 'TX' }, { city: 'San Antonio', state: 'TX' }, { city: 'Dallas', state: 'TX' },
  { city: 'Austin', state: 'TX' }, { city: 'Fort Worth', state: 'TX' }, { city: 'El Paso', state: 'TX' },
  { city: 'Philadelphia', state: 'PA' }, { city: 'Pittsburgh', state: 'PA' }, { city: 'Allentown', state: 'PA' },
  { city: 'Phoenix', state: 'AZ' }, { city: 'Tucson', state: 'AZ' }, { city: 'Mesa', state: 'AZ' },
  { city: 'San Jose', state: 'CA' }, { city: 'Jacksonville', state: 'FL' }, { city: 'Miami', state: 'FL' },
  { city: 'Tampa', state: 'FL' }, { city: 'Orlando', state: 'FL' }, { city: 'St. Petersburg', state: 'FL' },
  { city: 'Fort Lauderdale', state: 'FL' }, { city: 'Columbus', state: 'OH' }, { city: 'Cleveland', state: 'OH' },
  { city: 'Cincinnati', state: 'OH' }, { city: 'Toledo', state: 'OH' }, { city: 'Charlotte', state: 'NC' },
  { city: 'Raleigh', state: 'NC' }, { city: 'Greensboro', state: 'NC' }, { city: 'Durham', state: 'NC' },
  { city: 'Indianapolis', state: 'IN' }, { city: 'Fort Wayne', state: 'IN' }, { city: 'Seattle', state: 'WA' },
  { city: 'Spokane', state: 'WA' }, { city: 'Tacoma', state: 'WA' }, { city: 'Denver', state: 'CO' },
  { city: 'Colorado Springs', state: 'CO' }, { city: 'Boulder', state: 'CO' }, { city: 'Washington', state: 'DC' },
  { city: 'Boston', state: 'MA' }, { city: 'Worcester', state: 'MA' }, { city: 'Cambridge', state: 'MA' },
  { city: 'Nashville', state: 'TN' }, { city: 'Memphis', state: 'TN' }, { city: 'Knoxville', state: 'TN' },
  { city: 'Chattanooga', state: 'TN' }, { city: 'Detroit', state: 'MI' }, { city: 'Grand Rapids', state: 'MI' },
  { city: 'Ann Arbor', state: 'MI' }, { city: 'Portland', state: 'OR' }, { city: 'Eugene', state: 'OR' },
  { city: 'Las Vegas', state: 'NV' }, { city: 'Reno', state: 'NV' }, { city: 'Louisville', state: 'KY' },
  { city: 'Lexington', state: 'KY' }, { city: 'Baltimore', state: 'MD' }, { city: 'Annapolis', state: 'MD' },
  { city: 'Milwaukee', state: 'WI' }, { city: 'Madison', state: 'WI' }, { city: 'Green Bay', state: 'WI' },
  { city: 'Albuquerque', state: 'NM' }, { city: 'Santa Fe', state: 'NM' },
  { city: 'Atlanta', state: 'GA' }, { city: 'Savannah', state: 'GA' }, { city: 'Augusta', state: 'GA' },
  { city: 'Columbus', state: 'GA' }, { city: 'Kansas City', state: 'MO' }, { city: 'St. Louis', state: 'MO' },
  { city: 'Springfield', state: 'MO' }, { city: 'Omaha', state: 'NE' }, { city: 'Lincoln', state: 'NE' },
  { city: 'Minneapolis', state: 'MN' }, { city: 'St. Paul', state: 'MN' }, { city: 'Rochester', state: 'MN' },
  { city: 'Tulsa', state: 'OK' }, { city: 'Oklahoma City', state: 'OK' }, { city: 'New Orleans', state: 'LA' },
  { city: 'Baton Rouge', state: 'LA' }, { city: 'Shreveport', state: 'LA' }, { city: 'Salt Lake City', state: 'UT' },
  { city: 'Provo', state: 'UT' }, { city: 'Richmond', state: 'VA' }, { city: 'Virginia Beach', state: 'VA' },
  { city: 'Arlington', state: 'VA' }, { city: 'Birmingham', state: 'AL' }, { city: 'Montgomery', state: 'AL' },
  { city: 'Mobile', state: 'AL' }, { city: 'Boise', state: 'ID' }, { city: 'Des Moines', state: 'IA' },
  { city: 'Cedar Rapids', state: 'IA' }, { city: 'Wichita', state: 'KS' }, { city: 'Overland Park', state: 'KS' },
  { city: 'Little Rock', state: 'AR' }, { city: 'Jackson', state: 'MS' }, { city: 'Providence', state: 'RI' },
  { city: 'Hartford', state: 'CT' }, { city: 'New Haven', state: 'CT' }, { city: 'Bridgeport', state: 'CT' },
  { city: 'Manchester', state: 'NH' }, { city: 'Portland', state: 'ME' }, { city: 'Burlington', state: 'VT' },
  { city: 'Wilmington', state: 'DE' }, { city: 'Charleston', state: 'SC' }, { city: 'Columbia', state: 'SC' },
  { city: 'Greenville', state: 'SC' }, { city: 'Anchorage', state: 'AK' }, { city: 'Honolulu', state: 'HI' },
  { city: 'Billings', state: 'MT' }, { city: 'Fargo', state: 'ND' }, { city: 'Sioux Falls', state: 'SD' },
  { city: 'Cheyenne', state: 'WY' }, { city: 'Newark', state: 'NJ' }, { city: 'Jersey City', state: 'NJ' },
  { city: 'Trenton', state: 'NJ' },
];

// Defensive de-dup (a couple of cities legitimately share a name across
// different states, e.g. Rochester NY / Rochester MN -- those are kept;
// only exact city+state repeats are collapsed).
const UNIQUE_CITIES = [...new Map(CITIES.map((c) => [`${c.city}|${c.state}`, c])).values()];

function getCities() {
  return UNIQUE_CITIES;
}

module.exports = { CITIES: UNIQUE_CITIES, getCities };
