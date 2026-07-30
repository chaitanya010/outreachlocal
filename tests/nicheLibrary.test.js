const { NICHES, getNiches, getNicheByLabel } = require('../src/services/discovery/nicheLibrary');

describe('nicheLibrary', () => {
  test('has at least 100 niches', () => {
    expect(NICHES.length).toBeGreaterThanOrEqual(100);
  });

  test('every niche has label, category, and boolean tags', () => {
    for (const n of NICHES) {
      expect(typeof n.label).toBe('string');
      expect(n.label.length).toBeGreaterThan(0);
      expect(typeof n.category).toBe('string');
      expect(typeof n.callHeavy).toBe('boolean');
      expect(typeof n.appointmentHeavy).toBe('boolean');
    }
  });

  test('has no duplicate labels', () => {
    const labels = NICHES.map((n) => n.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('getNiches returns the full list', () => {
    expect(getNiches()).toBe(NICHES);
  });

  test('getNicheByLabel finds a known niche', () => {
    expect(getNicheByLabel('dental clinic')).toMatchObject({ callHeavy: true, appointmentHeavy: true });
  });

  test('getNicheByLabel returns undefined for unknown label', () => {
    expect(getNicheByLabel('not a real niche')).toBeUndefined();
  });
});
