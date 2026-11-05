import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  AAAA_WARNING_MESSAGE,
  ControlPlaneDnsService,
  evaluateDnsCheck,
  LOOKUP_FAILED_MESSAGE,
  PUBLIC_IP_UNKNOWN_MESSAGE,
  type DnsResolver,
} from '../control-plane-dns.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const checkedAt = new Date('2026-11-04T10:00:00.000Z');
const base = { hostname: 'cloud.example.com', checkedAt };

describe('evaluateDnsCheck', () => {
  it('is valid when the only A record is the public IP', () => {
    const check = evaluateDnsCheck({
      ...base,
      expectedIp: '203.0.113.10',
      a: { records: ['203.0.113.10'] },
      aaaa: { records: [] },
    });
    expect(check).toEqual({
      hostname: 'cloud.example.com',
      expected_ip: '203.0.113.10',
      records: ['203.0.113.10'],
      aaaa_records: [],
      status: 'valid',
      checked_at: '2026-11-04T10:00:00.000Z',
      message: null,
    });
  });

  it('is missing without A records', () => {
    expect(
      evaluateDnsCheck({
        ...base,
        expectedIp: '203.0.113.10',
        a: { records: [] },
        aaaa: { records: [] },
      }).status,
    ).toBe('missing');
  });

  it('is a mismatch when a record points elsewhere', () => {
    expect(
      evaluateDnsCheck({
        ...base,
        expectedIp: '203.0.113.10',
        a: { records: ['198.51.100.7'] },
        aaaa: { records: [] },
      }).status,
    ).toBe('mismatch');
  });

  it('is a mismatch when an extra A record exists', () => {
    expect(
      evaluateDnsCheck({
        ...base,
        expectedIp: '203.0.113.10',
        a: { records: ['198.51.100.7', '203.0.113.10'] },
        aaaa: { records: [] },
      }).status,
    ).toBe('mismatch');
  });

  it('warns about AAAA records', () => {
    expect(
      evaluateDnsCheck({
        ...base,
        expectedIp: '203.0.113.10',
        a: { records: ['203.0.113.10'] },
        aaaa: { records: ['2001:db8::1'] },
      }),
    ).toMatchObject({ status: 'valid', message: AAAA_WARNING_MESSAGE });
  });

  it('is an error when the public IP is unknown', () => {
    expect(
      evaluateDnsCheck({
        ...base,
        expectedIp: null,
        a: { records: ['203.0.113.10'] },
        aaaa: { records: [] },
      }),
    ).toMatchObject({ status: 'error', message: PUBLIC_IP_UNKNOWN_MESSAGE });
  });

  it('is an error when the lookup failed', () => {
    expect(
      evaluateDnsCheck({
        ...base,
        expectedIp: '203.0.113.10',
        a: { records: [], failed: true },
        aaaa: { records: [] },
      }),
    ).toMatchObject({ status: 'error', message: LOOKUP_FAILED_MESSAGE });
  });
});

describe('ControlPlaneDnsService', () => {
  const originalIp = process.env.ACCELERATIO_PUBLIC_IP;
  afterEach(() => {
    process.env.ACCELERATIO_PUBLIC_IP = originalIp;
  });

  const dnsError = (code: string) => Object.assign(new Error(code), { code });

  const createService = (
    resolver: DnsResolver,
    nodes: { type: string; address: string }[][] = [],
  ) => {
    const listNode = jest.fn().mockResolvedValue({
      items: nodes.map((addresses) => ({ status: { addresses } })),
    });
    const kubernetes = { coreV1: { listNode } } as unknown as KubernetesService;
    return {
      service: new ControlPlaneDnsService(kubernetes, () => resolver),
      listNode,
    };
  };

  it('uses ACCELERATIO_PUBLIC_IP without asking the cluster', async () => {
    process.env.ACCELERATIO_PUBLIC_IP = '203.0.113.10';
    const { service, listNode } = createService({
      resolve4: jest.fn().mockResolvedValue(['203.0.113.10']),
      resolve6: jest.fn().mockRejectedValue(dnsError('ENODATA')),
    });

    await expect(service.check('cloud.example.com')).resolves.toMatchObject({
      status: 'valid',
      records: ['203.0.113.10'],
    });
    expect(listNode).not.toHaveBeenCalled();
  });

  it('falls back to a node ExternalIP', async () => {
    delete process.env.ACCELERATIO_PUBLIC_IP;
    const { service } = createService(
      { resolve4: jest.fn(), resolve6: jest.fn() },
      [
        [{ type: 'InternalIP', address: '10.0.0.4' }],
        [{ type: 'ExternalIP', address: '203.0.113.20' }],
      ],
    );
    await expect(service.expectedIp()).resolves.toBe('203.0.113.20');
  });

  it('reports NXDOMAIN as missing', async () => {
    process.env.ACCELERATIO_PUBLIC_IP = '203.0.113.10';
    const { service } = createService({
      resolve4: jest.fn().mockRejectedValue(dnsError('ENOTFOUND')),
      resolve6: jest.fn().mockRejectedValue(dnsError('ENOTFOUND')),
    });
    await expect(service.check('cloud.example.com')).resolves.toMatchObject({
      status: 'missing',
    });
  });

  it('reports resolver failures as an error', async () => {
    process.env.ACCELERATIO_PUBLIC_IP = '203.0.113.10';
    const { service } = createService({
      resolve4: jest.fn().mockRejectedValue(dnsError('ETIMEOUT')),
      resolve6: jest.fn().mockResolvedValue([]),
    });
    await expect(service.check('cloud.example.com')).resolves.toMatchObject({
      status: 'error',
      message: LOOKUP_FAILED_MESSAGE,
    });
  });
});
