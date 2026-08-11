const { parseInboundMessage, isAutoSubmitted, isBounceNotification, stripQuotedReply } = require('../src/utils/replyParsing');

describe('isAutoSubmitted', () => {
  test('detects Auto-Submitted: auto-replied header', () => {
    const headers = new Map([['auto-submitted', 'auto-replied']]);
    expect(isAutoSubmitted(headers, 'Re: quick question')).toBe(true);
  });

  test('treats Auto-Submitted: no as not auto-submitted', () => {
    const headers = new Map([['auto-submitted', 'no']]);
    expect(isAutoSubmitted(headers, 'Re: quick question')).toBe(false);
  });

  test('falls back to subject regex when header is absent', () => {
    const headers = new Map();
    expect(isAutoSubmitted(headers, 'Out of Office: back Monday')).toBe(true);
    expect(isAutoSubmitted(headers, 'Automatic reply: away until further notice')).toBe(true);
    expect(isAutoSubmitted(headers, 'Undeliverable: quick question')).toBe(true);
  });

  test('returns false for a normal reply', () => {
    const headers = new Map();
    expect(isAutoSubmitted(headers, 'Re: quick question')).toBe(false);
  });

  test('handles missing/malformed headers gracefully', () => {
    expect(isAutoSubmitted(null, 'Re: quick question')).toBe(false);
    expect(isAutoSubmitted(undefined, undefined)).toBe(false);
  });
});

describe('isBounceNotification', () => {
  test('detects bounce-pattern subjects', () => {
    expect(isBounceNotification(new Map(), 'Undeliverable: quick question')).toBe(true);
    expect(isBounceNotification(new Map(), 'Delivery Status Notification (Failure)')).toBe(true);
    expect(isBounceNotification(new Map(), 'Mail delivery failed: returning message to sender')).toBe(true);
    expect(isBounceNotification(new Map(), 'Returned mail: see transcript for details')).toBe(true);
  });

  test('does not flag an OOO autoresponder as a bounce', () => {
    expect(isBounceNotification(new Map(), 'Out of Office: back Monday')).toBe(false);
    expect(isBounceNotification(new Map(), 'Automatic reply: away until further notice')).toBe(false);
  });

  test('detects RFC 3464 multipart/report content-type as a bounce regardless of subject', () => {
    const headers = new Map([['content-type', { value: 'multipart/report', params: { 'report-type': 'delivery-status' } }]]);
    expect(isBounceNotification(headers, 'Re: quick question')).toBe(true);
  });

  test('does not flag a normal reply as a bounce', () => {
    expect(isBounceNotification(new Map(), 'Re: quick question')).toBe(false);
  });
});

describe('stripQuotedReply', () => {
  test('cuts at "On ... wrote:" marker', () => {
    const text = 'Sure, we close at 6pm.\n\nOn Mon, Jan 5, 2026 at 9:00 AM Sid <sid@stanweb.tech> wrote:\n> what time do you close today?';
    expect(stripQuotedReply(text)).toBe('Sure, we close at 6pm.');
  });

  test('cuts at "-----Original Message-----" marker', () => {
    const text = 'Who is this?\n\n-----Original Message-----\nFrom: sid@stanweb.tech\nSent: today\n> what time do you close today?';
    expect(stripQuotedReply(text)).toBe('Who is this?');
  });

  test('cuts at first "> " quoted line when no marker is present', () => {
    const text = 'Please stop emailing me.\n> what time do you close today?\n> thanks';
    expect(stripQuotedReply(text)).toBe('Please stop emailing me.');
  });

  test('returns full trimmed text when there is nothing quoted', () => {
    expect(stripQuotedReply('  we close at 6pm  ')).toBe('we close at 6pm');
  });

  test('returns empty string for empty/null input', () => {
    expect(stripQuotedReply('')).toBe('');
    expect(stripQuotedReply(null)).toBe('');
  });
});

describe('parseInboundMessage', () => {
  test('extracts plain text body, subject, and headers from raw source', async () => {
    const raw = [
      'From: Test Lead <lead@example.com>',
      'To: sid@stanweb.tech',
      'Subject: Re: quick question',
      'Content-Type: text/plain',
      '',
      'Sure, we close at 6pm.',
      '',
    ].join('\r\n');

    const parsed = await parseInboundMessage(raw);
    expect(parsed.subject).toBe('Re: quick question');
    expect(parsed.text.trim()).toBe('Sure, we close at 6pm.');
    expect(parsed.headers.get('subject')).toBe('Re: quick question');
  });
});
