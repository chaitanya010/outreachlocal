const {
  classifyEmailConfidence,
  extractDecisionMaker,
  extractFromSchemaOrg,
} = require('../src/services/websiteEmailScraper');

describe('classifyEmailConfidence', () => {
  test('classifies generic role addresses as medium', () => {
    expect(classifyEmailConfidence('info@aspa.com')).toBe('medium');
    expect(classifyEmailConfidence('contact@aspa.com')).toBe('medium');
    expect(classifyEmailConfidence('bookings@aspa.com')).toBe('medium');
  });

  test('classifies personal-looking addresses as high', () => {
    expect(classifyEmailConfidence('jane@aspa.com')).toBe('high');
    expect(classifyEmailConfidence('jane.smith@aspa.com')).toBe('high');
  });

  test('returns null for no email', () => {
    expect(classifyEmailConfidence(null)).toBe(null);
    expect(classifyEmailConfidence('')).toBe(null);
  });
});

describe('extractDecisionMaker', () => {
  test('finds "Owner: Name" style pattern', () => {
    const html = '<p>Owner: Jane Smith</p>';
    expect(extractDecisionMaker(html)).toMatchObject({ name: 'Jane Smith' });
  });

  test('finds "Name, Role" style pattern', () => {
    const html = '<p>Jane Smith, Founder of the practice</p>';
    const result = extractDecisionMaker(html);
    expect(result.name).toBe('Jane Smith');
    expect(result.role).toBe('Founder');
  });

  test('returns null when no pattern matches', () => {
    expect(extractDecisionMaker('<p>Welcome to our website</p>')).toBe(null);
  });

  test('returns null for empty html', () => {
    expect(extractDecisionMaker('')).toBe(null);
    expect(extractDecisionMaker(null)).toBe(null);
  });
});

describe('extractFromSchemaOrg', () => {
  test('parses email from a JSON-LD block', () => {
    const html = `<script type="application/ld+json">{"@type":"LocalBusiness","email":"owner@aspa.com"}</script>`;
    expect(extractFromSchemaOrg(html)).toMatchObject({ email: 'owner@aspa.com' });
  });

  test('parses founder name from a JSON-LD block', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","founder":{"name":"Jane Smith"}}</script>`;
    const result = extractFromSchemaOrg(html);
    expect(result.name).toBe('Jane Smith');
    expect(result.role).toBe('Founder');
  });

  test('handles malformed JSON without throwing', () => {
    const html = `<script type="application/ld+json">{not valid json</script>`;
    expect(() => extractFromSchemaOrg(html)).not.toThrow();
    expect(extractFromSchemaOrg(html)).toBe(null);
  });

  test('returns null when no ld+json block exists', () => {
    expect(extractFromSchemaOrg('<p>no structured data here</p>')).toBe(null);
  });
});
