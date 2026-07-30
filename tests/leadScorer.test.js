const { scoreLeadForDiscovery, suggestService } = require('../src/services/leadScorer');

const callHeavyAppointmentNiche = { label: 'dental clinic', callHeavy: true, appointmentHeavy: true };
const neitherNiche = { label: 'storage facility', callHeavy: false, appointmentHeavy: false };

describe('scoreLeadForDiscovery', () => {
  test('scores a no-website, call-heavy, appointment-heavy business highly', () => {
    const lead = { has_website: false, website: null, phone: '555-1234', review_count: 30, rating: 4.5, has_booking: false };
    const result = scoreLeadForDiscovery(lead, callHeavyAppointmentNiche, null);

    expect(result.ai_opportunity_score).toBeGreaterThan(60);
    expect(result.suggested_service).toBe('Website Development');
  });

  test('scores a business with a great site in a low-fit niche low', () => {
    const lead = { has_website: true, website: 'https://a.com', phone: null, review_count: 3, rating: 4.5, has_booking: true };
    const siteSignals = {
      https: true,
      mobileResponsive: true,
      hasBookingWidget: true,
      hasChatWidget: true,
      isWordpress: false,
    };
    const result = scoreLeadForDiscovery(lead, neitherNiche, siteSignals);

    expect(result.ai_opportunity_score).toBeLessThan(20);
  });

  test('flags site-quality pain points and suggests Website Revamp for no-https', () => {
    const lead = { has_website: true, website: 'http://old.com', phone: '555', review_count: 10, rating: 4, has_booking: false };
    const siteSignals = {
      https: false,
      mobileResponsive: false,
      hasBookingWidget: false,
      hasChatWidget: false,
      isWordpress: true,
    };
    const result = scoreLeadForDiscovery(lead, neitherNiche, siteSignals);

    expect(result.problems).toEqual(
      expect.arrayContaining(['no_https', 'no_mobile_responsive', 'outdated_wordpress', 'no_booking_widget', 'no_chat_widget'])
    );
    expect(result.suggested_service).toBe('Website Revamp');
  });

  test('caps ai_opportunity_score at 100', () => {
    const lead = { has_website: false, website: null, phone: '555', review_count: 50, rating: 1, has_booking: false };
    const result = scoreLeadForDiscovery(lead, callHeavyAppointmentNiche, null);
    expect(result.ai_opportunity_score).toBeLessThanOrEqual(100);
  });

  test('still returns the base prospect_score fields unchanged', () => {
    const lead = { has_website: false, website: null, phone: null, review_count: 0, rating: null, has_booking: false };
    const result = scoreLeadForDiscovery(lead, neitherNiche, null);
    expect(result.prospect_score).toBeGreaterThan(0);
  });
});

describe('suggestService', () => {
  test('prioritizes Website Development for no website', () => {
    expect(suggestService({ hasWebsite: false, niche: callHeavyAppointmentNiche, lead: {}, siteSignals: null })).toBe(
      'Website Development'
    );
  });

  test('suggests AI Voice Receptionist for call-heavy niches with a fine site', () => {
    const siteSignals = { https: true, hasChatWidget: true, hasBookingWidget: true };
    expect(
      suggestService({ hasWebsite: true, niche: { callHeavy: true, appointmentHeavy: false }, lead: {}, siteSignals })
    ).toBe('AI Voice Receptionist');
  });

  test('falls back to CRM when nothing else applies', () => {
    const siteSignals = { https: true, hasChatWidget: true, hasBookingWidget: true };
    expect(suggestService({ hasWebsite: true, niche: neitherNiche, lead: { has_booking: true }, siteSignals })).toBe('CRM');
  });
});
