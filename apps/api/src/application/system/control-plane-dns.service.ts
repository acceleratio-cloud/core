import { Resolver } from 'node:dns/promises';
import { isIPv4 } from 'node:net';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { ControlPlaneDnsCheck } from '@acceleratio/shared';
import { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';

/** Public resolvers, so the answer is what the internet (and ACME) sees. */
const DEFAULT_RESOLVERS = ['1.1.1.1', '8.8.8.8'];
const LOOKUP_TIMEOUT_MS = 4000;
const NO_RECORD_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

/** Optional provider token that replaces the public resolver (tests). */
export const DNS_RESOLVER_FACTORY = Symbol('DNS_RESOLVER_FACTORY');

export const PUBLIC_IP_UNKNOWN_MESSAGE =
  'The server public IP is unknown. Set ACCELERATIO_PUBLIC_IP on the API.';
export const LOOKUP_FAILED_MESSAGE =
  'DNS lookup failed. Try again in a moment.';
export const AAAA_WARNING_MESSAGE =
  'The domain also has AAAA (IPv6) records. Remove them or point them to this server, or the HTTPS certificate may fail.';

/** Minimal resolver surface, injectable in tests. */
export interface DnsResolver {
  resolve4(hostname: string): Promise<string[]>;
  resolve6(hostname: string): Promise<string[]>;
}

export const createPublicResolver = (): DnsResolver => {
  const servers = (process.env.DNS_RESOLVERS ?? '')
    .split(',')
    .map((server) => server.trim())
    .filter(Boolean);
  const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 });
  resolver.setServers(servers.length > 0 ? servers : DEFAULT_RESOLVERS);
  return resolver;
};

const errorCode = (error: unknown): string | undefined =>
  typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;

/**
 * Checks that the control plane hostname has an A record pointing to this
 * server. The expected address comes from ACCELERATIO_PUBLIC_IP (set by the
 * installer), falling back to a node ExternalIP.
 */
@Injectable()
export class ControlPlaneDnsService {
  private readonly logger = new Logger(ControlPlaneDnsService.name);

  private readonly resolverFactory: () => DnsResolver;

  constructor(
    private readonly kubernetes: KubernetesService,
    @Optional()
    @Inject(DNS_RESOLVER_FACTORY)
    resolverFactory?: () => DnsResolver,
  ) {
    this.resolverFactory = resolverFactory ?? createPublicResolver;
  }

  async expectedIp(): Promise<string | null> {
    const configured = process.env.ACCELERATIO_PUBLIC_IP?.trim();
    if (configured && isIPv4(configured)) {
      return configured;
    }

    try {
      const nodes = await this.kubernetes.coreV1.listNode();
      for (const node of nodes.items) {
        const external = node.status?.addresses?.find(
          (address) => address.type === 'ExternalIP' && isIPv4(address.address),
        );
        if (external) {
          return external.address;
        }
      }
    } catch (error) {
      this.logger.warn(
        `Could not list nodes for the public IP: ${String(error)}`,
      );
    }

    return null;
  }

  async check(hostname: string): Promise<ControlPlaneDnsCheck> {
    const resolver = this.resolverFactory();
    const [expectedIp, a, aaaa] = await Promise.all([
      this.expectedIp(),
      this.lookup(() => resolver.resolve4(hostname)),
      this.lookup(() => resolver.resolve6(hostname)),
    ]);

    return evaluateDnsCheck({
      hostname,
      expectedIp,
      a,
      aaaa,
      checkedAt: new Date(),
    });
  }

  private async lookup(
    resolve: () => Promise<string[]>,
  ): Promise<LookupResult> {
    try {
      return { records: [...new Set(await resolve())].sort() };
    } catch (error) {
      if (NO_RECORD_CODES.has(errorCode(error) ?? '')) {
        return { records: [] };
      }
      this.logger.warn(`DNS lookup failed: ${String(error)}`);
      return { records: [], failed: true };
    }
  }
}

export interface LookupResult {
  records: string[];
  failed?: boolean;
}

interface EvaluateInput {
  hostname: string;
  expectedIp: string | null;
  a: LookupResult;
  aaaa: LookupResult;
  checkedAt: Date;
}

/** Pure mapping from lookup results to the reported status. */
export const evaluateDnsCheck = ({
  hostname,
  expectedIp,
  a,
  aaaa,
  checkedAt,
}: EvaluateInput): ControlPlaneDnsCheck => {
  const base = {
    hostname,
    expected_ip: expectedIp,
    records: a.records,
    aaaa_records: aaaa.records,
    checked_at: checkedAt.toISOString(),
  };
  const warning = aaaa.records.length > 0 ? AAAA_WARNING_MESSAGE : null;

  if (!expectedIp) {
    return { ...base, status: 'error', message: PUBLIC_IP_UNKNOWN_MESSAGE };
  }
  if (a.failed) {
    return { ...base, status: 'error', message: LOOKUP_FAILED_MESSAGE };
  }
  if (a.records.length === 0) {
    return { ...base, status: 'missing', message: warning };
  }
  if (a.records.length === 1 && a.records[0] === expectedIp) {
    return { ...base, status: 'valid', message: warning };
  }
  return { ...base, status: 'mismatch', message: warning };
};
