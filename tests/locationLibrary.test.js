const { CITIES, getCities } = require('../src/services/discovery/locationLibrary');

describe('locationLibrary', () => {
  test('has a substantial number of cities', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(100);
  });

  test('every city has a city, state/region, and country', () => {
    for (const c of CITIES) {
      expect(typeof c.city).toBe('string');
      expect(c.city.length).toBeGreaterThan(0);
      expect(typeof c.state).toBe('string');
      expect(c.state.length).toBeGreaterThan(0);
      expect(typeof c.country).toBe('string');
      expect(c.country.length).toBeGreaterThan(0);
    }
  });

  test('US entries use 2-letter state codes', () => {
    for (const c of CITIES.filter((c) => c.country === 'United States')) {
      expect(c.state.length).toBe(2);
    }
  });

  test('covers multiple English-speaking countries beyond the US', () => {
    const countries = new Set(CITIES.map((c) => c.country));
    expect(countries).toEqual(new Set([
      'United States', 'United Kingdom', 'Australia', 'Canada', 'Ireland', 'New Zealand',
    ]));
  });

  test('has no duplicate city+state+country triples', () => {
    const keys = CITIES.map((c) => `${c.city}|${c.state}|${c.country}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('getCities returns the same list', () => {
    expect(getCities()).toEqual(CITIES);
  });
});
