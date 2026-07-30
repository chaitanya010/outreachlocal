const { CITIES, getCities } = require('../src/services/discovery/locationLibrary');

describe('locationLibrary', () => {
  test('has a substantial number of cities', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(100);
  });

  test('every city has a city and state', () => {
    for (const c of CITIES) {
      expect(typeof c.city).toBe('string');
      expect(c.city.length).toBeGreaterThan(0);
      expect(typeof c.state).toBe('string');
      expect(c.state.length).toBe(2);
    }
  });

  test('has no duplicate city+state pairs', () => {
    const keys = CITIES.map((c) => `${c.city}|${c.state}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('getCities returns the same list', () => {
    expect(getCities()).toEqual(CITIES);
  });
});
