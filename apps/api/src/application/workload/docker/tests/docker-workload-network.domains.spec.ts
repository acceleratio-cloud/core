import { BadRequestException } from '@nestjs/common';
import type { DnsCheck } from '@acceleratio/shared';
import {
  AWAITING_RECORD_MESSAGE,
  describeDnsCheck,
  generatedHostname,
  generatedSuffix,
  ISSUING_CERTIFICATE_MESSAGE,
  maxGeneratedLabelLength,
  normalizeCustomHostname,
  normalizePort,
  suggestedLabel,
  WILDCARD_ZONE_MESSAGE,
} from '../docker-workload-network.domains';

const ip = '203.0.113.10';

describe('normalizePort', () => {
  it.each([1, 80, 8080, 65535])('accepts %p', (port) => {
    expect(normalizePort(port)).toBe(port);
  });

  it.each([0, 65536, 80.5, '80', null, undefined, Number.NaN])(
    'rejects %p',
    (port) => {
      expect(() => normalizePort(port)).toThrow(BadRequestException);
    },
  );
});

describe('generated hostnames', () => {
  it('joins the label and the dashed IP under sslip.io', () => {
    expect(generatedSuffix(ip)).toBe('-203-0-113-10.sslip.io');
    expect(generatedHostname('api', ip)).toBe('api-203-0-113-10.sslip.io');
  });

  it('lowercases and trims the label', () => {
    expect(generatedHostname('  My-App ', ip)).toBe(
      'my-app-203-0-113-10.sslip.io',
    );
  });

  it('keeps the first DNS label within 63 characters', () => {
    const max = maxGeneratedLabelLength(ip);

    expect(max).toBe(63 - '203-0-113-10'.length - 1);
    expect(generatedHostname('a'.repeat(max), ip).split('.')[0]).toHaveLength(
      63,
    );
    expect(() => generatedHostname('a'.repeat(max + 1), ip)).toThrow(
      BadRequestException,
    );
  });

  it.each(['', '-api', 'api-', 'a.b', 'a_b', 'api!', 42])(
    'rejects the label %p',
    (label) => {
      expect(() => generatedHostname(label, ip)).toThrow(BadRequestException);
    },
  );

  it('suggests a label from the service name', () => {
    expect(suggestedLabel('My API', ip)).toBe('my-api');
    expect(suggestedLabel('!!!', ip)).toBe('workload');
    expect(suggestedLabel('x'.repeat(80), ip)).toHaveLength(
      maxGeneratedLabelLength(ip),
    );
  });
});

describe('normalizeCustomHostname', () => {
  it.each([
    ['app.example.com', 'app.example.com'],
    ['  APP.Example.com. ', 'app.example.com'],
    ['https://app.example.com/', 'app.example.com'],
    ['http://example.com', 'example.com'],
  ])('normalizes %p', (input, expected) => {
    expect(normalizeCustomHostname(input)).toBe(expected);
  });

  it.each([
    '',
    'localhost',
    'example',
    '203.0.113.10',
    'app.example.com:8443',
    'app.example.com/path',
    'ftp://app.example.com',
    'user@app.example.com',
    'app.example.com?x',
    '*.example.com',
    null,
  ])('rejects %p', (input) => {
    expect(() => normalizeCustomHostname(input)).toThrow(BadRequestException);
  });

  it.each(['api-203-0-113-10.sslip.io', 'sslip.io', 'x.10.0.0.1.nip.io'])(
    'sends %p to Generate domain',
    (input) => {
      expect(() => normalizeCustomHostname(input)).toThrow(
        WILDCARD_ZONE_MESSAGE,
      );
    },
  );
});

describe('describeDnsCheck', () => {
  const check = (overrides: Partial<DnsCheck>): DnsCheck => ({
    hostname: 'app.example.com',
    expected_ip: ip,
    records: [],
    aaaa_records: [],
    status: 'missing',
    checked_at: '2026-11-05T10:00:00.000Z',
    message: null,
    ...overrides,
  });

  it('describes each status', () => {
    expect(describeDnsCheck(check({ status: 'valid' }))).toBe(
      ISSUING_CERTIFICATE_MESSAGE,
    );
    expect(describeDnsCheck(check({ status: 'missing' }))).toBe(
      AWAITING_RECORD_MESSAGE,
    );
    expect(
      describeDnsCheck(
        check({ status: 'mismatch', records: ['198.51.100.1'] }),
      ),
    ).toBe('The A record points to 198.51.100.1 instead of 203.0.113.10.');
    expect(
      describeDnsCheck(check({ status: 'error', message: 'Lookup failed' })),
    ).toBe('Lookup failed');
  });
});
