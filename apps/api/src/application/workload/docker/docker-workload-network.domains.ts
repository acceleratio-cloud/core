import { isIPv4 } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import type { DnsCheck } from '@acceleratio/shared';
import { DNS_LABEL_PATTERN, isValidHostname } from '@/common/hostname';
import { DNS1123_LABEL_MAX_LENGTH, slugify } from '@/common/naming';

export const SSLIP_ZONE = 'sslip.io';
/** Wildcard-DNS zones that resolve to an embedded IP: only generated ones. */
const WILDCARD_IP_ZONES = ['sslip.io', 'nip.io'];
export const PORT_MIN = 1;
export const PORT_MAX = 65535;
export const CUSTOM_DOMAINS_MAX = 20;

export const INVALID_PORT_MESSAGE = `Port must be a whole number between ${PORT_MIN} and ${PORT_MAX}`;
export const INVALID_LABEL_MESSAGE =
  'Use lowercase letters, digits and hyphens, starting and ending with a letter or digit';
export const INVALID_HOSTNAME_MESSAGE =
  'Enter a domain name such as app.example.com, without a path or port';
export const WILDCARD_ZONE_MESSAGE =
  'sslip.io and nip.io hostnames cannot be added as custom domains. Use Generate domain instead.';

export const normalizePort = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < PORT_MIN ||
    value > PORT_MAX
  ) {
    throw new BadRequestException(INVALID_PORT_MESSAGE);
  }

  return value;
};

/** `203.0.113.10` → `203-0-113-10`. */
export const dashedIp = (ip: string): string => ip.replace(/\./g, '-');

/**
 * `-<a-b-c-d>.sslip.io`. The IP is joined to the label with a dash, not a dot,
 * so every generated hostname is its own registered domain under the public
 * suffix `sslip.io` and gets its own Let's Encrypt rate limit.
 */
export const generatedSuffix = (ip: string): string =>
  `-${dashedIp(ip)}.${SSLIP_ZONE}`;

/** Longest label that still fits the first DNS label with the IP suffix. */
export const maxGeneratedLabelLength = (ip: string): number =>
  DNS1123_LABEL_MAX_LENGTH - dashedIp(ip).length - 1;

/** `api` + `203.0.113.10` → `api-203-0-113-10.sslip.io`. */
export const generatedHostname = (label: unknown, ip: string): string => {
  if (!isIPv4(ip)) {
    throw new Error(`Not an IPv4 address: ${ip}`);
  }

  const normalized =
    typeof label === 'string' ? label.trim().toLowerCase() : '';

  if (
    !DNS_LABEL_PATTERN.test(normalized) ||
    normalized.length > maxGeneratedLabelLength(ip)
  ) {
    throw new BadRequestException(
      `${INVALID_LABEL_MESSAGE}, at most ${maxGeneratedLabelLength(ip)} characters`,
    );
  }

  return `${normalized}${generatedSuffix(ip)}`;
};

/** A label prefilled from the service name, cut to fit the suffix. */
export const suggestedLabel = (name: string, ip: string | null): string => {
  const max = ip ? maxGeneratedLabelLength(ip) : DNS1123_LABEL_MAX_LENGTH;

  return slugify(name).slice(0, max).replace(/-+$/, '') || 'app';
};

/**
 * Accepts `app.example.com` or `http(s)://app.example.com[/]` and returns the
 * lowercase hostname. Paths, ports, credentials, IP addresses and wildcard IP
 * zones are rejected.
 */
export const normalizeCustomHostname = (input: unknown): string => {
  if (typeof input !== 'string' || !input.trim()) {
    throw new BadRequestException(INVALID_HOSTNAME_MESSAGE);
  }

  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;
  let parsed: URL;

  try {
    parsed = new URL(withScheme);
  } catch {
    throw new BadRequestException(INVALID_HOSTNAME_MESSAGE);
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    /[?#]/.test(raw)
  ) {
    throw new BadRequestException(INVALID_HOSTNAME_MESSAGE);
  }

  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();

  if (!isValidHostname(hostname)) {
    throw new BadRequestException(INVALID_HOSTNAME_MESSAGE);
  }

  if (
    WILDCARD_IP_ZONES.some(
      (zone) => hostname === zone || hostname.endsWith(`.${zone}`),
    )
  ) {
    throw new BadRequestException(WILDCARD_ZONE_MESSAGE);
  }

  return hostname;
};

export const AWAITING_RECORD_MESSAGE = 'Waiting for the A record.';
export const ISSUING_CERTIFICATE_MESSAGE =
  'The A record is in place. Issuing the HTTPS certificate.';
export const GENERATED_ISSUING_MESSAGE =
  'Issuing the HTTPS certificate. Browsers show a certificate warning until it is ready.';
export const GENERATED_CERTIFICATE_TIMEOUT_MESSAGE =
  'The HTTPS certificate was not issued within 10 minutes. Check that ports 80 and 443 are open to the internet; it is retried automatically.';
export const CERTIFICATE_TIMEOUT_MESSAGE =
  'The HTTPS certificate was not issued within 10 minutes. Check that ports 80 and 443 are open and that the A record is correct, then check again.';

/** What a custom domain waiting for its record tells the user. */
export const describeDnsCheck = (dns: DnsCheck): string => {
  switch (dns.status) {
    case 'valid':
      return ISSUING_CERTIFICATE_MESSAGE;
    case 'mismatch':
      return `The A record points to ${dns.records.join(', ')} instead of ${dns.expected_ip}.`;
    case 'missing':
      return dns.message
        ? `${AWAITING_RECORD_MESSAGE} ${dns.message}`
        : AWAITING_RECORD_MESSAGE;
    default:
      return dns.message ?? 'DNS lookup failed. Try again in a moment.';
  }
};
