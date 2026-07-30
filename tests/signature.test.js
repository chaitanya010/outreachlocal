describe('signature.buildSignature', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('default is zero-link: bare domain only, no Calendly/contact', () => {
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    process.env.WHATSAPP_SIGNATURE_NUMBER = '+91 8007519898';
    delete process.env.SIGNATURE_INCLUDE_CONTACT;
    delete process.env.SIGNATURE_INCLUDE_CALENDLY;
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('stanweb.tech');
    expect(sig).not.toContain('Schedule a meeting');
    expect(sig).not.toContain('calendly.com');
    expect(sig).not.toContain('WhatsApp');
    expect(sig).not.toContain('@');
  });

  test('SIGNATURE_INCLUDE_CALENDLY=true adds the Calendly line', () => {
    process.env.SIGNATURE_INCLUDE_CALENDLY = 'true';
    process.env.CALENDLY_URL = 'https://calendly.com/x/30min';
    const { buildSignature } = require('../src/utils/signature');

    expect(buildSignature()).toContain('Schedule a meeting with me: https://calendly.com/x/30min');
  });

  test('SIGNATURE_INCLUDE_CONTACT=true adds contact lines without reintroducing website/LinkedIn links', () => {
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    process.env.SENDER_LINKEDIN = 'https://www.linkedin.com/in/someone/';
    process.env.SENDER_WEBSITE = 'https://stanweb.tech';
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).toContain('contact@stanweb.tech');
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

  test('SIGNATURE_INCLUDE_CONTACT=true omits optional contact lines entirely when unset', () => {
    process.env.SIGNATURE_INCLUDE_CONTACT = 'true';
    delete process.env.WHATSAPP_SIGNATURE_NUMBER;
    delete process.env.SENDER_PHONE;
    const { buildSignature } = require('../src/utils/signature');

    const sig = buildSignature();
    expect(sig).not.toContain('WhatsApp');
    expect(sig).not.toContain('Phone');
  });
});
