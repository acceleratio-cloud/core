import { BadRequestException } from '@nestjs/common';
import { isValidHostname } from '@/common/hostname';

export const INVALID_URL_MESSAGE =
  'Enter a domain name such as cloud.example.com, without a path or port';

export interface ControlPlaneUrl {
  /** Normalized root URL, always `https://<hostname>`. */
  url: string;
  hostname: string;
}

/**
 * Accepts `cloud.example.com` or `http(s)://cloud.example.com[/]` and returns
 * the HTTPS root URL. The control plane is served on ports 80/443 at the root
 * of the host, so paths, ports, credentials and IP addresses are rejected.
 */
export const normalizeControlPlaneUrl = (input: unknown): ControlPlaneUrl => {
  if (typeof input !== 'string' || !input.trim()) {
    throw new BadRequestException(INVALID_URL_MESSAGE);
  }

  const raw = input.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new BadRequestException(INVALID_URL_MESSAGE);
  }

  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash ||
    // `new URL` drops a trailing "?" or "#", so check the raw input too.
    /[?#]/.test(raw)
  ) {
    throw new BadRequestException(INVALID_URL_MESSAGE);
  }

  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();

  if (!isValidHostname(hostname)) {
    throw new BadRequestException(INVALID_URL_MESSAGE);
  }

  return { url: `https://${hostname}`, hostname };
};

/** Origin (scheme + host) of a stored control plane URL. */
export const toOrigin = (url: string): string => new URL(url).origin;
