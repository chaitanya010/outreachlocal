const { analyzeHtml } = require('../src/services/websiteAnalyzer');

describe('analyzeHtml', () => {
  test('detects https from the url', () => {
    expect(analyzeHtml({ html: '<html></html>', url: 'https://a.com' }).https).toBe(true);
    expect(analyzeHtml({ html: '<html></html>', url: 'http://a.com' }).https).toBe(false);
  });

  test('detects mobile viewport meta tag', () => {
    const html = '<head><meta name="viewport" content="width=device-width"></head>';
    expect(analyzeHtml({ html, url: 'https://a.com' }).mobileResponsive).toBe(true);
    expect(analyzeHtml({ html: '<head></head>', url: 'https://a.com' }).mobileResponsive).toBe(false);
  });

  test('detects known booking widget vendors', () => {
    const html = '<script src="https://widget.vagaro.com/embed.js"></script>';
    expect(analyzeHtml({ html, url: 'https://a.com' }).hasBookingWidget).toBe(true);
    expect(analyzeHtml({ html: '<div></div>', url: 'https://a.com' }).hasBookingWidget).toBe(false);
  });

  test('detects known chat widget vendors', () => {
    const html = '<script src="https://widget.intercom.io/widget/abc"></script>';
    expect(analyzeHtml({ html, url: 'https://a.com' }).hasChatWidget).toBe(true);
    expect(analyzeHtml({ html: '<div></div>', url: 'https://a.com' }).hasChatWidget).toBe(false);
  });

  test('detects WordPress via wp-content path', () => {
    const html = '<link href="/wp-content/themes/x/style.css">';
    expect(analyzeHtml({ html, url: 'https://a.com' }).isWordpress).toBe(true);
  });

  test('detects social links', () => {
    const html = '<a href="https://facebook.com/mybiz">FB</a><a href="https://instagram.com/mybiz">IG</a>';
    const result = analyzeHtml({ html, url: 'https://a.com' });
    expect(result.hasFacebookLink).toBe(true);
    expect(result.hasInstagramLink).toBe(true);
  });

  test('passes through responseTimeMs', () => {
    expect(analyzeHtml({ html: '', url: 'https://a.com', responseTimeMs: 123 }).responseTimeMs).toBe(123);
    expect(analyzeHtml({ html: '', url: 'https://a.com' }).responseTimeMs).toBe(null);
  });

  test('handles a malformed url gracefully', () => {
    expect(() => analyzeHtml({ html: '', url: 'not-a-url' })).not.toThrow();
    expect(analyzeHtml({ html: '', url: 'not-a-url' }).https).toBe(false);
  });
});
