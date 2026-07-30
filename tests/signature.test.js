describe('signature.buildSignature', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('defaults to name/title only (no contact lines at all)', () => {
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    process.env.WHATSAPP_SIGNATURE_NUMBER = '+91 8007519898';
    delete process.env.SIGNATURE_INCLUDE_CONTACT;
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).not.toContain('calendly.com');
    expect(sig).not.toContain('WhatsApp');
    expect(sig).not.toContain('@');
  });

  test('SIGNATURE_INCLUDE_CONTACT=true keeps total links to Calendly only (no website/LinkedIn links)', () => {
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    process.env.SENDER_LINKEDIN = 'https://www.linkedin.com/in/someone/';
    process.env.SENDER_WEBSITE = 'https://stanweb.tech';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('calendly.com');
    expect(sig).not.toContain('linkedin.com');
    expect(sig).not.toContain('stanweb.tech/'); // no bare website link line
  });

  test('SIGNATURE_INCLUDE_CONTACT=true renders WhatsApp as a plain number, not a wa.me link', () => {
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    process.env.WHATSAPP_SIGNATURE_NUMBER = 'https://wa.me/+918007519898';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('+918007519898');
    expect(sig).not.toContain('wa.me');
  });

  test('SIGNATURE_INCLUDE_CONTACT=true handles a raw WhatsApp number without a wa.me prefix', () => {
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    process.env.WHATSAPP_SIGNATURE_NUMBER = '+91 8007519898';
    const { buildSignature } = require('../src/utils/signature');

    expect(buildSignature()).toContain('+91 8007519898');
  });

  test('SIGNATURE_INCLUDE_CONTACT=true omits optional lines entirely when unset', () => {
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
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
