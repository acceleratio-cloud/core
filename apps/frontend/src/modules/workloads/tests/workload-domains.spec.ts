import { describe, expect, it } from 'bun:test';

import type { WorkloadDomain } from '@acceleratio/shared';
import {
  canCheckCertificate,
  cleanHostname,
  domainDisplayState,
  hasPendingDomains,
  isDomainLive,
  labelError,
  maxLabelLength,
  parsePort,
} from '@/modules/workloads/utils/workload-domains';

const domain = (
  status: WorkloadDomain['status'],
  certificate: WorkloadDomain['certificate'] = status === 'success' ||
  status === 'generated'
    ? 'issued'
    : 'waiting',
): WorkloadDomain => ({
  id: 'd1',
  workload_id: 'w1',
  hostname: 'app.example.com',
  url: 'https://app.example.com',
  kind: 'custom',
  port: 80,
  status,
  status_message: null,
  routed: certificate !== 'waiting',
  certificate,
  dns_records: [],
  dns: null,
  verified_at: null,
  created_at: '2026-11-05T10:00:00.000Z',
  updated_at: '2026-11-05T10:00:00.000Z',
});

describe('parsePort', () => {
  it('accepts whole numbers from 1 to 65535', () => {
    expect(parsePort('80')).toBe(80);
    expect(parsePort(' 8080 ')).toBe(8080);
    expect(parsePort('65535')).toBe(65535);
  });

  it('rejects everything else', () => {
    for (const value of ['', '0', '65536', '80.5', '-1', 'http', '8e3']) {
      expect(parsePort(value)).toBeNull();
    }
  });
});

describe('generated labels', () => {
  it('leaves room for the IP suffix in the first DNS label', () => {
    // 63 minus "-203-0-113-10".
    expect(maxLabelLength('-203-0-113-10.sslip.io')).toBe(50);
    expect(maxLabelLength(null)).toBe(63);
  });

  it('validates the label shape and length', () => {
    expect(labelError('my-api', 50)).toBeNull();
    expect(labelError('My-API', 50)).toBeNull();
    expect(labelError('', 50)).not.toBeNull();
    expect(labelError('-api', 50)).not.toBeNull();
    expect(labelError('a.b', 50)).not.toBeNull();
    expect(labelError('a'.repeat(51), 50)).not.toBeNull();
  });
});

describe('domain display state', () => {
  it('is live only once the certificate is issued', () => {
    expect(domainDisplayState(domain('generated', 'issuing'))).toBe('issuing');
    expect(isDomainLive(domain('generated', 'issuing'))).toBe(false);
    expect(domainDisplayState(domain('generated', 'issued'))).toBe('live');
    expect(domainDisplayState(domain('generated', 'failed'))).toBe(
      'ssl_failed',
    );
  });

  it('separates waiting for DNS from issuing for custom domains', () => {
    expect(domainDisplayState(domain('verification', 'waiting'))).toBe('dns');
    expect(domainDisplayState(domain('verification', 'issuing'))).toBe(
      'issuing',
    );
    expect(domainDisplayState(domain('success', 'issued'))).toBe('live');
    expect(domainDisplayState(domain('failed', 'failed'))).toBe('failed');
  });

  it('offers a certificate check only for routed domains without one', () => {
    expect(canCheckCertificate(domain('generated', 'issuing'))).toBe(true);
    expect(canCheckCertificate(domain('generated', 'failed'))).toBe(true);
    expect(canCheckCertificate(domain('generated', 'issued'))).toBe(false);
    expect(canCheckCertificate(domain('verification', 'waiting'))).toBe(false);
  });

  it('polls while a certificate is being issued', () => {
    expect(hasPendingDomains([domain('generated', 'issuing')])).toBe(true);
    expect(hasPendingDomains([domain('generated', 'failed')])).toBe(false);
  });
});

describe('domain status', () => {
  it('treats generated and success domains as live', () => {
    expect(isDomainLive(domain('generated'))).toBe(true);
    expect(isDomainLive(domain('success'))).toBe(true);
    expect(isDomainLive(domain('verification'))).toBe(false);
    expect(isDomainLive(domain('failed'))).toBe(false);
  });

  it('polls only while a domain is in verification', () => {
    expect(hasPendingDomains([domain('success'), domain('failed')])).toBe(
      false,
    );
    expect(hasPendingDomains([domain('verification')])).toBe(true);
  });
});

describe('cleanHostname', () => {
  it('strips a scheme, trailing slash and dot, and lowercases', () => {
    expect(cleanHostname(' https://App.Example.com/ ')).toBe('app.example.com');
    expect(cleanHostname('app.example.com.')).toBe('app.example.com');
  });
});
