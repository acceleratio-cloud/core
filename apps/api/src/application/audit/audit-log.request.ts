import { BlockList, isIP } from 'node:net';
import type { IncomingMessage } from 'node:http';

/**
 * Field names whose values are never stored. `value` covers env variables;
 * `url`/`uri`/`dsn` usually carry credentials. Matched on word boundaries
 * (`_`, `-`, camelCase), so `bypass` or `sessionAffinity` are not secrets.
 */
const SENSITIVE_WORDS = new Set([
  'pass',
  'passwd',
  'password',
  'passphrase',
  'secret',
  'token',
  'credential',
  'credentials',
  'private',
  'auth',
  'authorization',
  'cookie',
  'apikey',
  'dsn',
  'url',
  'uri',
  'value',
]);
/** Identifiers that contain a sensitive word but are not secrets themselves. */
const SAFE_KEYS = new Set(['secret_name', 'access_key_id', 'token_type']);

const isSensitiveKey = (key: string): boolean => {
  if (SAFE_KEYS.has(key)) {
    return false;
  }
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  const joined = words.join('');
  return (
    words.some((word) => SENSITIVE_WORDS.has(word)) ||
    /apikey|accesskey|secretkey|privatekey/.test(joined)
  );
};
/** Objects whose every value is user-supplied and may be a secret. */
const VALUES_HIDDEN = new Set(['inputs', 'env', 'environment']);
/** `scheme://user:password@host`: the password part. */
const URL_PASSWORD = /(\/\/[^/\s:@]+:)[^/\s@]+@/g;
const MAX_DEPTH = 6;
const MAX_STRING = 500;
const MAX_ITEMS = 100;
export const REDACTED = '[redacted]';

const hideValues = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(hideValues)
    : typeof value === 'object' && value !== null
      ? Object.fromEntries(
          Object.entries(value).map(([key, item]) => [
            key,
            key === 'key' || key === 'name' ? sanitize(item) : REDACTED,
          ]),
        )
      : REDACTED;

/**
 * A JSON-safe copy of a request body with secrets and large values cut:
 * sensitive field names, every value of free-form maps (inputs, env) and
 * passwords inside URLs are replaced.
 */
export const sanitize = (value: unknown, depth = 0): unknown => {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    const scrubbed = value.replace(URL_PASSWORD, `$1${REDACTED}@`);
    return scrubbed.length > MAX_STRING
      ? `${scrubbed.slice(0, MAX_STRING)}… (${scrubbed.length} chars)`
      : scrubbed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return `[binary ${value.length} bytes]`;
  }
  if (depth >= MAX_DEPTH) {
    return '[truncated]';
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ITEMS).map((item) => sanitize(item, depth + 1));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        isSensitiveKey(key)
          ? REDACTED
          : VALUES_HIDDEN.has(key)
            ? hideValues(item)
            : sanitize(item, depth + 1),
      ]),
    );
  }
  // Functions, symbols and bigints never come from a JSON body.
  return null;
};

/**
 * Peers allowed to name the client in X-Forwarded-For: loopback and private
 * networks, where Traefik and the pod network live. Anyone else could forge it.
 */
const TRUSTED_PROXIES = new BlockList();
TRUSTED_PROXIES.addSubnet('127.0.0.0', 8, 'ipv4');
TRUSTED_PROXIES.addSubnet('10.0.0.0', 8, 'ipv4');
TRUSTED_PROXIES.addSubnet('172.16.0.0', 12, 'ipv4');
TRUSTED_PROXIES.addSubnet('192.168.0.0', 16, 'ipv4');
TRUSTED_PROXIES.addAddress('::1', 'ipv6');
TRUSTED_PROXIES.addSubnet('fc00::', 7, 'ipv6');

const isTrustedProxy = (address: string): boolean => {
  const family = isIP(address);
  return (
    family !== 0 &&
    TRUSTED_PROXIES.check(address, family === 4 ? 'ipv4' : 'ipv6')
  );
};

const stripMapped = (address: string): string =>
  address.startsWith('::ffff:') ? address.slice(7) : address;

/**
 * The client address. X-Forwarded-For is read right to left, skipping trusted
 * proxies, and only when the socket peer is itself a trusted proxy; otherwise
 * the socket peer is the client. The raw peer is returned too.
 */
export const clientAddress = (
  request: Pick<IncomingMessage, 'headers' | 'socket'>,
): { ip: string | null; remote: string | null } => {
  const remote = request.socket?.remoteAddress
    ? stripMapped(request.socket.remoteAddress)
    : null;

  if (!remote || !isTrustedProxy(remote)) {
    return { ip: remote, remote };
  }

  const header = request.headers['x-forwarded-for'];
  const hops = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((hop) => stripMapped(hop.trim()))
    .filter((hop) => isIP(hop) !== 0);

  // shortcut: a client inside a private network can still forge its hop; a
  // configurable proxy list is the upgrade if the API is exposed on a LAN.
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxy(hops[index]) || index === 0) {
      return { ip: hops[index], remote };
    }
  }

  return { ip: remote, remote };
};

export const userAgentOf = (
  request: Pick<IncomingMessage, 'headers'>,
): string | null => request.headers['user-agent']?.slice(0, 512) ?? null;
