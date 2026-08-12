const {
  generateDecoyOpener,
  offerForLead,
  outcomeForLead,
  buildFallbackObservation,
} = require('../src/services/aiMessageService');

describe('generateDecoyOpener: category-aware plausibility', () => {
  test('appointment-based business gets "what time do you close" style', () => {
    const lead = { name: 'Glow Nail Spa', business_type: 'Nail Salon', email: 'a@b.com' };
    const opener = generateDecoyOpener(lead, 'Sid', 1);
    expect(opener.text).toMatch(/close today/i);
  });

  test('b2b professional-services business does NOT get a "closing hours" question', () => {
    const lead = { name: 'Acme Financial Advisors', business_type: 'Financial Services', email: 'a@b.com' };
    const opener = generateDecoyOpener(lead, 'Sid', 1);
    expect(opener.text).not.toMatch(/close today/i);
    expect(opener.text).toMatch(/taking on new clients/i);
  });

  test('b2b industrial business gets a quote/capacity-style question', () => {
    const lead = { name: 'Ironclad Logistics', business_type: 'Warehousing', email: 'a@b.com' };
    const opener = generateDecoyOpener(lead, 'Sid', 1);
    expect(opener.text).not.toMatch(/close today/i);
    expect(opener.text).toMatch(/quote for a small job/i);
  });

  test('emergency home service business gets an availability-style question', () => {
    const lead = { name: 'Rapid HVAC Repair', business_type: 'HVAC', email: 'a@b.com' };
    const opener = generateDecoyOpener(lead, 'Sid', 1);
    expect(opener.text).toMatch(/service call/i);
  });

  test('stage 2 picks the second variant within the same category', () => {
    const lead = { name: 'Ironclad Logistics', business_type: 'Warehousing', email: 'a@b.com' };
    const stage1 = generateDecoyOpener(lead, 'Sid', 1);
    const stage2 = generateDecoyOpener(lead, 'Sid', 2);
    expect(stage1.text).not.toBe(stage2.text);
  });
});

describe('offerForLead / outcomeForLead: category fallback', () => {
  test('exact keyword match wins over category fallback', () => {
    expect(offerForLead({ business_type: 'HVAC' })).toMatch(/24\/7 emergency call answering/);
    expect(outcomeForLead({ business_type: 'HVAC' })).toBe('service calls');
  });

  test('unmapped b2b professional business_type falls back to the professional-services offer, not the generic consumer one', () => {
    const offer = offerForLead({ business_type: 'Immigration Law Consultancy XYZ' });
    expect(offer).toMatch(/consultation scheduling|new-client inquiry/);
  });

  test('unmapped b2b industrial business_type gets an industrial-relevant fallback', () => {
    const offer = offerForLead({ business_type: 'Custom Machinery Fabrication' });
    expect(offer).toMatch(/dispatch|new-business inquiry|floor/);
    expect(outcomeForLead({ business_type: 'Custom Machinery Fabrication' })).toBe('inquiries');
  });

  test('totally unknown business_type still falls back to appointment_consumer defaults', () => {
    expect(outcomeForLead({ business_type: 'Something Nobody Has Seen Before' })).toBe('appointments');
  });
});

describe('buildFallbackObservation', () => {
  test('builds a sentence from business_type + city when nothing else is available', () => {
    const obs = buildFallbackObservation({ name: 'Acme Co', business_type: 'Financial Services', city: 'Denver, CO' });
    expect(obs).toBe('Acme Co is a Financial Services, based in Denver.');
  });

  test('includes rating only when review_count is meaningfully high', () => {
    const withReviews = buildFallbackObservation({ name: 'Acme Co', business_type: 'Salon', city: 'Miami', rating: 4.8, review_count: 40 });
    expect(withReviews).toMatch(/rated 4\.8 stars across 40 reviews/);

    const fewReviews = buildFallbackObservation({ name: 'Acme Co', business_type: 'Salon', city: 'Miami', rating: 4.8, review_count: 1 });
    expect(fewReviews).not.toMatch(/rated/);
  });

  test('returns empty string when the lead has no usable fields at all', () => {
    expect(buildFallbackObservation({ name: 'Acme Co' })).toBe('');
  });
});
