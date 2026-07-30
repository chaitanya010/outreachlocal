const { buildPersonalizationSentence } = require('../src/services/personalizationEngine');

describe('buildPersonalizationSentence', () => {
  test('is deterministic for the same inputs', () => {
    const lead = { name: 'A Spa', business_type: 'med spa' };
    const intel = { suggested_service: 'AI Voice Receptionist', problems: ['no_booking'] };

    const first = buildPersonalizationSentence(lead, intel);
    const second = buildPersonalizationSentence(lead, intel);

    expect(first).toBe(second);
  });

  test('mentions the business niche', () => {
    const lead = { name: 'A Spa', business_type: 'med spa' };
    const intel = { suggested_service: 'Website Development', problems: [] };
    expect(buildPersonalizationSentence(lead, intel)).toContain('med spa');
  });

  test('falls back gracefully for an unknown suggested_service', () => {
    const lead = { name: 'A Spa', business_type: 'med spa' };
    const intel = { suggested_service: 'Something Unrecognized', problems: [] };
    expect(() => buildPersonalizationSentence(lead, intel)).not.toThrow();
  });

  test('includes a pain point description when problems are present', () => {
    const lead = { name: 'A Spa', business_type: 'med spa' };
    const intel = { suggested_service: 'Appointment Automation', problems: ['no_booking'] };
    const sentence = buildPersonalizationSentence(lead, intel);
    expect(sentence.toLowerCase()).toContain('booking');
  });
});
