import { createVerify, generateKeyPairSync } from 'node:crypto';
import { signAppJwt } from '../github.client';

describe('signAppJwt', () => {
  it('signs an RS256 token for the App that GitHub can verify', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
    const now = Date.UTC(2026, 0, 1);
    const [header, payload, signature] = signAppJwt(42, pem, now).split('.');

    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      iss: string;
      iat: number;
      exp: number;
    };
    expect(claims.iss).toBe('42');
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(10 * 60);
    expect(
      createVerify('RSA-SHA256')
        .update(`${header}.${payload}`)
        .verify(publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);
  });
});
