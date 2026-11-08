import { randomBytes } from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  signState,
  verifyState,
} from '../secret-box';

const key = randomBytes(32);

describe('secret-box', () => {
  it('round-trips a secret and never repeats a ciphertext', () => {
    const a = encryptSecret('-----BEGIN KEY-----', key);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toContain('BEGIN');
    expect(decryptSecret(a, key)).toBe('-----BEGIN KEY-----');
    expect(encryptSecret('-----BEGIN KEY-----', key)).not.toBe(a);
  });

  it('rejects a tampered ciphertext and a different key', () => {
    const value = encryptSecret('secret', key);
    const parts = value.split(':');
    parts[3] = Buffer.from('xxxxxx').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret(value, randomBytes(32))).toThrow();
  });

  it('verifies a signed state until it expires', () => {
    const token = signState({ a: 1 }, 60_000, key);
    expect(verifyState<{ a: number }>(token, key)?.a).toBe(1);
    expect(verifyState(token, randomBytes(32))).toBeNull();
    expect(verifyState(`${token}x`, key)).toBeNull();
    expect(verifyState(signState({ a: 1 }, -1, key), key)).toBeNull();
  });
});
