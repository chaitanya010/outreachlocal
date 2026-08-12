'use strict';

/**
 * Curated list of mid/large cities used for geographic rotation, across the
 * US plus other major English-speaking markets (UK, Australia, Canada,
 * Ireland, New Zealand) -- same language for the cold-email copy, same
 * general SMB-outreach playbook.
 *
 * Google Places Text Search operates at city granularity (a "state > county
 * > city > ZIP" random-walk isn't something the API can usefully target --
 * ZIP-level text search just re-finds the same city's results). So rotation
 * here is region -> city: enough spread to avoid over-mining any one metro,
 * while staying at a granularity the discovery sources can actually query.
 *
 * Non-US entries bake the country directly into `city` (e.g. "Manchester,
 * UK") rather than adding a separate query parameter. Two reasons: (1) the
 * discovery sources (googlePlacesSource, yelpSource, bestOfCitySource) all
 * take a single `city` string and pass it straight into a text query --
 * without a country hint, "spa in Manchester" or "spa in Cambridge" is
 * genuinely ambiguous against the equivalent US city of the same name; (2)
 * that same string is what ends up stored as the lead's `city` column, so
 * baking the country in there also makes stored leads self-describing on
 * the dashboard. US entries are left exactly as before (bare city name, no
 * ", USA" suffix) -- they've been unambiguous in practice and changing the
 * format would touch how ~13k already-searched pairs and existing stored
 * leads read, for zero benefit.
 */

const US_CITIES = [
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
].map((c) => ({ ...c, country: 'United States' }));

const UK_CITIES = [
  { city: 'London, UK', state: 'England' }, { city: 'Manchester, UK', state: 'England' },
  { city: 'Birmingham, UK', state: 'England' }, { city: 'Leeds, UK', state: 'England' },
  { city: 'Glasgow, UK', state: 'Scotland' }, { city: 'Liverpool, UK', state: 'England' },
  { city: 'Bristol, UK', state: 'England' }, { city: 'Sheffield, UK', state: 'England' },
  { city: 'Edinburgh, UK', state: 'Scotland' }, { city: 'Newcastle, UK', state: 'England' },
  { city: 'Nottingham, UK', state: 'England' }, { city: 'Cardiff, UK', state: 'Wales' },
  { city: 'Belfast, UK', state: 'Northern Ireland' }, { city: 'Leicester, UK', state: 'England' },
  { city: 'Coventry, UK', state: 'England' }, { city: 'Bradford, UK', state: 'England' },
  { city: 'Southampton, UK', state: 'England' }, { city: 'Portsmouth, UK', state: 'England' },
  { city: 'Aberdeen, UK', state: 'Scotland' }, { city: 'Reading, UK', state: 'England' },
  { city: 'Brighton, UK', state: 'England' }, { city: 'Plymouth, UK', state: 'England' },
  { city: 'Derby, UK', state: 'England' }, { city: 'Oxford, UK', state: 'England' },
  { city: 'Cambridge, UK', state: 'England' }, { city: 'York, UK', state: 'England' },
  { city: 'Swansea, UK', state: 'Wales' }, { city: 'Norwich, UK', state: 'England' },
  { city: 'Exeter, UK', state: 'England' }, { city: 'Bath, UK', state: 'England' },
].map((c) => ({ ...c, country: 'United Kingdom' }));

const AU_CITIES = [
  { city: 'Sydney, Australia', state: 'NSW' }, { city: 'Melbourne, Australia', state: 'VIC' },
  { city: 'Brisbane, Australia', state: 'QLD' }, { city: 'Perth, Australia', state: 'WA' },
  { city: 'Adelaide, Australia', state: 'SA' }, { city: 'Gold Coast, Australia', state: 'QLD' },
  { city: 'Canberra, Australia', state: 'ACT' }, { city: 'Newcastle, Australia', state: 'NSW' },
  { city: 'Wollongong, Australia', state: 'NSW' }, { city: 'Hobart, Australia', state: 'TAS' },
  { city: 'Geelong, Australia', state: 'VIC' }, { city: 'Townsville, Australia', state: 'QLD' },
  { city: 'Cairns, Australia', state: 'QLD' }, { city: 'Darwin, Australia', state: 'NT' },
  { city: 'Toowoomba, Australia', state: 'QLD' }, { city: 'Ballarat, Australia', state: 'VIC' },
  { city: 'Bendigo, Australia', state: 'VIC' }, { city: 'Launceston, Australia', state: 'TAS' },
].map((c) => ({ ...c, country: 'Australia' }));

const CA_CITIES = [
  { city: 'Toronto, Canada', state: 'ON' }, { city: 'Montreal, Canada', state: 'QC' },
  { city: 'Vancouver, Canada', state: 'BC' }, { city: 'Calgary, Canada', state: 'AB' },
  { city: 'Edmonton, Canada', state: 'AB' }, { city: 'Ottawa, Canada', state: 'ON' },
  { city: 'Winnipeg, Canada', state: 'MB' }, { city: 'Quebec City, Canada', state: 'QC' },
  { city: 'Hamilton, Canada', state: 'ON' }, { city: 'Kitchener, Canada', state: 'ON' },
  { city: 'London, Canada', state: 'ON' }, { city: 'Halifax, Canada', state: 'NS' },
  { city: 'Victoria, Canada', state: 'BC' }, { city: 'Saskatoon, Canada', state: 'SK' },
  { city: 'Regina, Canada', state: 'SK' },
].map((c) => ({ ...c, country: 'Canada' }));

const IE_CITIES = [
  { city: 'Dublin, Ireland', state: 'Dublin' }, { city: 'Cork, Ireland', state: 'Cork' },
  { city: 'Galway, Ireland', state: 'Galway' }, { city: 'Limerick, Ireland', state: 'Limerick' },
  { city: 'Waterford, Ireland', state: 'Waterford' }, { city: 'Kilkenny, Ireland', state: 'Kilkenny' },
].map((c) => ({ ...c, country: 'Ireland' }));

const NZ_CITIES = [
  { city: 'Auckland, New Zealand', state: 'Auckland' }, { city: 'Wellington, New Zealand', state: 'Wellington' },
  { city: 'Christchurch, New Zealand', state: 'Canterbury' }, { city: 'Hamilton, New Zealand', state: 'Waikato' },
  { city: 'Tauranga, New Zealand', state: 'Bay of Plenty' }, { city: 'Dunedin, New Zealand', state: 'Otago' },
].map((c) => ({ ...c, country: 'New Zealand' }));

const CITIES = [
  ...US_CITIES, ...UK_CITIES, ...AU_CITIES, ...CA_CITIES, ...IE_CITIES, ...NZ_CITIES,
];

// Defensive de-dup, keyed on city+state+country so legitimate same-name
// cities in different regions/countries (Rochester NY/MN, London UK/Canada,
// Hamilton Canada/NZ) are all kept; only exact repeats collapse.
const UNIQUE_CITIES = [...new Map(CITIES.map((c) => [`${c.city}|${c.state}|${c.country}`, c])).values()];

function getCities() {
  return UNIQUE_CITIES;
}

module.exports = { CITIES: UNIQUE_CITIES, getCities };
