describe('signature.buildSignature', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('default is first-name-only, no brand/title/links at all', () => {
    process.env.SENDER_NAME = 'Chaitanya Kapre';
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    process.env.WHATSAPP_SIGNATURE_NUMBER = '+91 8007519898';
    delete process.env.SIGNATURE_INCLUDE_BRAND;
    delete process.env.SIGNATURE_INCLUDE_CONTACT;
    delete process.env.SIGNATURE_INCLUDE_CALENDLY;
    const { buildSignature } = require('../src/utils/signature');

    expect(buildSignature()).toBe('Chaitanya');
  });

  test('SIGNATURE_INCLUDE_BRAND=true adds full name/title/bare-domain', () => {
    process.env.SIGNATURE_INCLUDE_BRAND = 'true';
    process.env.SENDER_NAME = 'Chaitanya Kapre';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('Chaitanya Kapre');
    expect(sig).toContain('stanweb.tech');
    expect(sig).not.toContain('Schedule a meeting');
    expect(sig).not.toContain('@');
  });

  test('SIGNATURE_INCLUDE_BRAND=true + SIGNATURE_INCLUDE_CALENDLY=true adds the Calendly line', () => {
    process.env.SIGNATURE_INCLUDE_BRAND = 'true';
    process.env.SIGNATURE_INCLUDE_CALENDLY = 'true';
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    const { buildSignature } = require('../src/utils/signature');

    expect(buildSignature()).toContain('Schedule a meeting with me: https://calendly.com/x/30min');
  });

  test('SIGNATURE_INCLUDE_BRAND=true + SIGNATURE_INCLUDE_CONTACT=true adds contact lines without website/LinkedIn links', () => {
    process.env.SIGNATURE_INCLUDE_BRAND = 'true';
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    process.env.SENDER_LINKEDIN = 'https://www.linkedin.com/in/someone/';
    process.env.SENDER_WEBSITE = 'https://stanweb.tech';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('contact@stanweb.tech');
    expect(sig).not.toContain('linkedin.com');
    expect(sig).not.toContain('stanweb.tech/'); // no bare website link line
  });

  test('SIGNATURE_INCLUDE_BRAND=true + SIGNATURE_INCLUDE_CONTACT=true renders WhatsApp as a plain number, not a wa.me link', () => {
    process.env.SIGNATURE_INCLUDE_BRAND = 'true';
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    process.env.WHATSAPP_SIGNATURE_NUMBER = 'https://wa.me/+918007519898';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('+918007519898');
    expect(sig).not.toContain('wa.me');
  });
});
