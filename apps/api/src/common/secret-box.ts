import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Application-level encryption for secrets kept in the database (GitHub App
 * keys). The key lives in the API's environment, never in the database, so a
 * database dump alone does not expose them. Ciphertext is `v1:<iv>:<tag>:<data>`;
 * the prefix names the key version so a rotation can be added later.
 */
const VERSION = 'v1';
export const KEY_MISSING_MESSAGE =
  'INTEGRATIONS_ENCRYPTION_KEY is not set. Set it to a 32-byte value (base64 or 64 hex characters) and restart the API.';

export const getEncryptionKey = (
  value = process.env.INTEGRATIONS_ENCRYPTION_KEY ?? '',
): Buffer => {
  // deploy/install.sh writes 64 hex characters; scripts/dev.sh writes base64.
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error(KEY_MISSING_MESSAGE);
  }
  return key;
};

export const encryptSecret = (
  plain: string,
  key = getEncryptionKey(),
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64')))
    .join(':');
};

export const decryptSecret = (
  value: string,
  key = getEncryptionKey(),
): string => {
  const [version, iv, tag, data] = value.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined) {
    throw new Error('Unsupported secret format');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(iv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};

const sign = (payload: string, key: Buffer) =>
  createHmac('sha256', key).update(payload).digest('base64url');

/** Signed, expiring token that carries a JSON payload through a redirect. */
export const signState = (
  payload: Record<string, unknown>,
  ttlMs: number,
  key = getEncryptionKey(),
): string => {
  const body = Buffer.from(
    JSON.stringify({ ...payload, exp: Date.now() + ttlMs }),
  ).toString('base64url');
  return `${body}.${sign(body, key)}`;
};

export const verifyState = <T extends Record<string, unknown>>(
  token: string,
  key = getEncryptionKey(),
): T | null => {
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, key));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as T & {
      exp?: number;
    };
    return typeof payload.exp === 'number' && payload.exp > Date.now()
      ? payload
      : null;
  } catch {
    return null;
  }
};
