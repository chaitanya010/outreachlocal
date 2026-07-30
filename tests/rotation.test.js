jest.mock('../src/db/leadsRepository', () => ({
  getRecentSearchHistory: jest.fn(),
  recordSearchHistory: jest.fn(),
}));

const { getRecentSearchHistory, recordSearchHistory } = require('../src/db/leadsRepository');
const { pickTodayPairs, recordUsedPairs } = require('../src/services/discovery/rotation');
const { NICHES } = require('../src/services/discovery/nicheLibrary');
const { CITIES } = require('../src/services/discovery/locationLibrary');

describe('rotation.pickTodayPairs', () => {
  test('excludes pairs already searched within the cooldown window', async () => {
    // Force every possible pair except one to be "recently used" so the
    // picker is forced to converge on that single remaining pair.
    const survivor = `${NICHES[0].label}|${CITIES[0].city}`;
    const allKeys = [];
    for (const n of NICHES) {
      for (const c of CITIES) {
        const key = `${n.label}|${c.city}`;
        if (key !== survivor) allKeys.push(key);
      }
    }
    getRecentSearchHistory.mockResolvedValue(new Set(allKeys));

    const picked = await pickTodayPairs(1);

    expect(picked).toHaveLength(1);
    expect(`${picked[0].niche}|${picked[0].city}`).toBe(survivor);
  });

  test('returns fewer than requested if the pool is fully exhausted, without hanging', async () => {
    const allKeys = [];
    for (const n of NICHES) {
      for (const c of CITIES) allKeys.push(`${n.label}|${c.city}`);
    }
    getRecentSearchHistory.mockResolvedValue(new Set(allKeys));

    const picked = await pickTodayPairs(5);

    expect(picked).toEqual([]);
  });

  test('never returns duplicate pairs within the same batch', async () => {
    getRecentSearchHistory.mockResolvedValue(new Set());

    const picked = await pickTodayPairs(10);
    const keys = picked.map((p) => `${p.niche}|${p.city}`);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('rotation.recordUsedPairs', () => {
  test('delegates to leadsRepository.recordSearchHistory', async () => {
    const pairs = [{ niche: 'dental clinic', city: 'Miami', state: 'FL' }];
    await recordUsedPairs(pairs);
    expect(recordSearchHistory).toHaveBeenCalledWith(pairs);
  });

  test('does nothing for an empty list', async () => {
    recordSearchHistory.mockClear();
    await recordUsedPairs([]);
    expect(recordSearchHistory).not.toHaveBeenCalled();
  });
});
