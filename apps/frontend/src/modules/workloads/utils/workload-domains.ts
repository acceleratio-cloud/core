import type { WorkloadDomain } from '@acceleratio/shared';

export const PORT_MIN = 1;
export const PORT_MAX = 65535;
export const CUSTOM_DOMAINS_MAX = 20;

export type DomainTone = 'success' | 'pending' | 'danger';

/**
 * What a domain row shows: the routing status and the HTTPS certificate
 * combined, so a domain never reads as live while browsers would still show a
 * certificate warning.
 */
export type DomainDisplayState =
  'live' | 'dns' | 'issuing' | 'ssl_failed' | 'failed';

const PENDING_DOT =
  // Triangle: pending reads by shape as well as color.
  'size-2.5 bg-status-warning [clip-path:polygon(50%_0,100%_100%,0_100%)] animate-pulse motion-reduce:animate-none';

export const domainStateStyles: Record<
  DomainDisplayState,
  {
    label: string;
    tone: DomainTone;
    dot: string;
    text: string;
    description: string;
  }
> = {
  live: {
    label: 'Live',
    tone: 'success',
    dot: 'size-2 rounded-full bg-status-success',
    text: 'text-fg-secondary',
    description: 'Serving over HTTPS with a trusted certificate.',
  },
  dns: {
    label: 'Pending',
    tone: 'pending',
    dot: PENDING_DOT,
    text: 'text-fg-secondary',
    description: 'Waiting for the A record.',
  },
  issuing: {
    label: 'Issuing SSL',
    tone: 'pending',
    dot: PENDING_DOT,
    text: 'text-fg-secondary',
    description:
      'Requesting the HTTPS certificate. Browsers show a certificate warning until it is issued, usually within a minute.',
  },
  ssl_failed: {
    label: 'SSL failed',
    tone: 'danger',
    dot: 'size-2 rounded-[1px] bg-destructive',
    text: 'text-destructive',
    description:
      'No certificate was issued in 10 minutes. Browsers show a certificate warning.',
  },
  failed: {
    label: 'Failed',
    tone: 'danger',
    dot: 'size-2 rounded-[1px] bg-destructive',
    text: 'text-destructive',
    description: 'The certificate was not issued and the domain is not routed.',
  },
};

export const domainDisplayState = (
  domain: WorkloadDomain,
): DomainDisplayState => {
  if (domain.certificate === 'issued') {
    return 'live';
  }

  if (domain.status === 'failed') {
    return 'failed';
  }

  if (domain.certificate === 'failed') {
    return 'ssl_failed';
  }

  return domain.certificate === 'issuing' ? 'issuing' : 'dns';
};

/** True when the domain serves the service over trusted HTTPS. */
export const isDomainLive = (domain: WorkloadDomain): boolean =>
  domain.certificate === 'issued';

/** True when a "check now" can move the certificate forward. */
export const canCheckCertificate = (domain: WorkloadDomain): boolean =>
  domain.routed && domain.certificate !== 'issued';

/** True while the console should keep polling for a status change. */
export const hasPendingDomains = (domains: WorkloadDomain[]): boolean =>
  domains.some(
    (domain) =>
      domain.status === 'verification' || domain.certificate === 'issuing',
  );

/** A port from a text field, or null when it is not 1–65535. */
export const parsePort = (value: string): number | null => {
  const trimmed = value.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const port = Number(trimmed);

  return port >= PORT_MIN && port <= PORT_MAX ? port : null;
};

export const PORT_ERROR = `Enter a port between ${PORT_MIN} and ${PORT_MAX}.`;

const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Client-side check of a generated-domain label; the API has the last word. */
export const labelError = (label: string, maxLength: number): string | null => {
  const value = label.trim().toLowerCase();

  if (!value) {
    return 'Enter a label.';
  }

  if (value.length > maxLength) {
    return `Keep the label within ${maxLength} characters.`;
  }

  return LABEL_PATTERN.test(value)
    ? null
    : 'Use letters, digits and hyphens, starting and ending with a letter or digit.';
};

/** `-203-0-113-10.sslip.io` leaves this many characters for the label. */
export const maxLabelLength = (suffix: string | null): number =>
  suffix ? 63 - suffix.indexOf('.') : 63;

/** Drops a scheme, a trailing slash and a trailing dot, and lowercases. */
export const cleanHostname = (value: string): string =>
  value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')
    .replace(/\.$/, '')
    .toLowerCase();
