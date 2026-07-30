describe('signature.buildSignature', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('keeps total links to Calendly only (no website/LinkedIn links)', () => {
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    process.env.SENDER_LINKEDIN = 'https://www.linkedin.com/in/someone/';
    process.env.SENDER_WEBSITE = 'https://stanweb.tech';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('calendly.com');
    expect(sig).not.toContain('linkedin.com');
    expect(sig).not.toContain('stanweb.tech/'); // no bare website link line
  });

  test('renders WhatsApp as a plain number, not a wa.me link', () => {
    process.env.WHATSAPP_SIGNATURE_NUMBER = 'https://wa.me/+918007519898';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('+918007519898');
    expect(sig).not.toContain('wa.me');
  });

  test('handles a raw WhatsApp number without a wa.me prefix', () => {
    process.env.WHATSAPP_SIGNATURE_NUMBER = '+91 8007519898';
    const { buildSignature } = require('../src/utils/signature');

    expect(buildSignature()).toContain('+91 8007519898');
  });

  test('omits optional lines entirely when unset', () => {
    delete process.env.CALENDLY_URL;
    delete process.env.WHATSAPP_SIGNATURE_NUMBER;
    delete process.env.SENDER_PHONE;
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).not.toContain('Book a call');
    expect(sig).not.toContain('WhatsApp');
    expect(sig).not.toContain('Phone');
  });
});
