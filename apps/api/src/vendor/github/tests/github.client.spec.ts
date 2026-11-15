import { createVerify, generateKeyPairSync } from 'node:crypto';
import { BadGatewayException } from '@nestjs/common';
import { GithubClient, signAppJwt } from '../github.client';

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

describe('GithubClient without a token', () => {
  const answer = (status: number, body: unknown = {}) =>
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(body), { status }));

  afterEach(() => jest.restoreAllMocks());

  it('checks one branch, slashes encoded, and sends no Authorization', async () => {
    const fetch = answer(200, { name: 'feat/x' });

    await expect(
      new GithubClient().hasBranch(undefined, 'acme/api', 'feat/x'),
    ).resolves.toBe(true);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/acme/api/branches/feat%2Fx');
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      undefined,
    );
  });

  it('reads a missing branch as false and any other failure as an error', async () => {
    answer(404, { message: 'Branch not found' });
    await expect(
      new GithubClient().hasBranch(undefined, 'acme/api', 'gone'),
    ).resolves.toBe(false);

    answer(403, { message: 'API rate limit exceeded' });
    const failure = await new GithubClient()
      .hasBranch(undefined, 'acme/api', 'main')
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(BadGatewayException);
    expect((failure as BadGatewayException).getResponse()).toEqual({
      message: 'GitHub returned 403: API rate limit exceeded',
      error: 'Bad Gateway',
      statusCode: 502,
    });
    expect((failure as Error).cause).toBe(403);
  });
});
