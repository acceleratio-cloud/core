import { BadRequestException } from '@nestjs/common';
import { normalizeControlPlaneUrl, toOrigin } from '../control-plane-url';

describe('normalizeControlPlaneUrl', () => {
  it.each([
    ['cloud.example.com', 'https://cloud.example.com'],
    ['  Cloud.Example.COM  ', 'https://cloud.example.com'],
    ['https://cloud.example.com', 'https://cloud.example.com'],
    ['https://cloud.example.com/', 'https://cloud.example.com'],
    ['http://cloud.example.com', 'https://cloud.example.com'],
    ['cloud.example.com.', 'https://cloud.example.com'],
    ['a.b.example.co.uk', 'https://a.b.example.co.uk'],
    ['xn--80ak6aa92e.xn--p1ai', 'https://xn--80ak6aa92e.xn--p1ai'],
  ])('accepts %p', (input, url) => {
    expect(normalizeControlPlaneUrl(input).url).toBe(url);
  });

  it('returns the hostname', () => {
    expect(normalizeControlPlaneUrl('https://cloud.example.com').hostname).toBe(
      'cloud.example.com',
    );
  });

  it.each([
    [''],
    ['   '],
    [undefined],
    [42],
    ['https://cloud.example.com/console'],
    ['https://cloud.example.com:8443'],
    ['https://cloud.example.com?x=1'],
    ['https://cloud.example.com#top'],
    ['https://user:pass@cloud.example.com'],
    ['ftp://cloud.example.com'],
    ['http://203.0.113.10'],
    ['203.0.113.10'],
    ['[2001:db8::1]'],
    ['localhost'],
    ['app.localhost'],
    ['intranet'],
    ['-bad.example.com'],
    ['bad_host.example.com'],
    ['example.c'],
    ['example.123'],
  ])('rejects %p', (input) => {
    expect(() => normalizeControlPlaneUrl(input)).toThrow(BadRequestException);
  });
});

describe('toOrigin', () => {
  it('returns scheme and host', () => {
    expect(toOrigin('https://cloud.example.com')).toBe(
      'https://cloud.example.com',
    );
  });
});
