import { createHmac, randomBytes } from 'node:crypto';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { signState } from '@/common/secret-box';
import { GithubService, publicName } from '../github.service';
import { verifyWebhookSignature } from '../github-webhook';

// The real SystemService pulls in the ESM-only Kubernetes client.
jest.mock('@/application/system/system.service', () => ({
  SystemService: class {},
}));
jest.mock('@/vendor/auth/trusted-origins', () => ({
  isTrustedOrigin: (origin: string) => origin === 'https://cloud.example.com',
}));

const ID = '11111111-1111-4111-8111-111111111111';
const payload = {
  name: 'My App',
  organization: 'acme',
  return_url: 'https://cloud.example.com/settings',
};

const makeService = (
  current_url: string | null = 'https://cloud.example.com',
) =>
  new GithubService(
    {} as never,
    {} as never,
    { getControlPlane: () => Promise.resolve({ current_url }) } as never,
  );

describe('verifyWebhookSignature', () => {
  const body = Buffer.from('{"action":"created"}');
  const header = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`;

  it('accepts the matching signature only', () => {
    expect(verifyWebhookSignature('s3cret', body, header)).toBe(true);
    expect(verifyWebhookSignature('other', body, header)).toBe(false);
    expect(verifyWebhookSignature('s3cret', Buffer.from('{}'), header)).toBe(
      false,
    );
    expect(verifyWebhookSignature('s3cret', body, undefined)).toBe(false);
    expect(verifyWebhookSignature('s3cret', undefined, header)).toBe(false);
  });
});

describe('GithubService', () => {
  it('returns the browser to the GitHub integration page', () => {
    const service = makeService();
    expect(service.returnUrl('https://cloud.example.com', 'created')).toBe(
      'https://cloud.example.com/settings/integrations/github?github=created',
    );
    expect(
      service.returnUrl('https://cloud.example.com', 'error', 'bad state'),
    ).toBe(
      'https://cloud.example.com/settings/integrations/github?github=error&github_error=bad+state',
    );
  });

  beforeAll(() => {
    process.env.INTEGRATIONS_ENCRYPTION_KEY =
      randomBytes(32).toString('base64');
    delete process.env.GITHUB_CALLBACK_BASE_URL;
  });

  it('builds a manifest whose URLs point at the control plane API', async () => {
    const request = await makeService().createManifest(payload, 'user-1');
    const manifest = JSON.parse(request.manifest) as {
      hook_attributes: { url: string };
      redirect_url: string;
      setup_url: string;
    };

    expect(request.post_url).toMatch(
      /^https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=/,
    );
    expect(manifest.redirect_url).toBe(
      'https://cloud.example.com/api/integrations/github/manifest/callback',
    );
    expect(manifest.hook_attributes.url).toMatch(
      /^https:\/\/cloud\.example\.com\/api\/integrations\/github\/apps\/[0-9a-f-]{36}\/webhook$/,
    );
    expect(manifest.setup_url).toContain('/installed');
  });

  it('works without a domain: browser URLs use the installer address, webhook is off', async () => {
    process.env.BETTER_AUTH_URL = 'http://10.0.0.5:30080';
    try {
      const request = await makeService(null).createManifest(payload, 'u');
      const manifest = JSON.parse(request.manifest) as {
        hook_attributes: { active: boolean };
        redirect_url: string;
      };

      expect(manifest.redirect_url).toBe(
        'http://10.0.0.5:30080/integrations/github/manifest/callback',
      );
      expect(manifest.hook_attributes.active).toBe(false);
    } finally {
      delete process.env.BETTER_AUTH_URL;
    }
  });

  it('turns the webhook on only for an HTTPS address', async () => {
    const request = await makeService().createManifest(payload, 'u');
    expect(
      (JSON.parse(request.manifest) as { hook_attributes: { active: boolean } })
        .hook_attributes.active,
    ).toBe(true);
  });

  it('rejects an unknown console origin and a bad organization', async () => {
    const service = makeService();
    await expect(
      service.createManifest(
        { ...payload, return_url: 'https://evil.test/' },
        'u',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createManifest({ ...payload, organization: 'a/../b' }, 'u'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a callback whose state is forged, expired or of another flow', async () => {
    const service = makeService();
    const wrongFlow = signState({ t: 'install', app: ID, ret: 'x' }, 60_000);
    const expired = signState({ t: 'manifest', id: ID }, -1);

    await expect(
      service.completeManifest('code', 'garbage'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.completeManifest('code', wrongFlow),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.completeManifest('code', expired),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an install state issued for a different App', async () => {
    const state = signState(
      { t: 'install', app: ID, ret: 'https://cloud.example.com' },
      60_000,
    );
    await expect(
      makeService().completeInstall(
        '22222222-2222-4222-8222-222222222222',
        1,
        state,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('public repositories', () => {
  const withClient = (client: Record<string, jest.Mock>) =>
    new GithubService({} as never, client as never, {} as never);

  it('takes owner/name only, never a path that leaves the repository', () => {
    expect(publicName('acme/api.js')).toBe('acme/api.js');

    for (const name of [
      '',
      'acme',
      'acme/api/branches',
      '../x',
      'acme/..',
      'acme/.',
      'a b/c',
      'acme/api?x=1',
    ]) {
      expect(() => publicName(name)).toThrow(BadRequestException);
    }
  });

  it('points a missing or private repository at the Private tab', async () => {
    const service = withClient({
      publicRepository: jest
        .fn()
        .mockRejectedValue(
          new BadGatewayException('GitHub returned 404', { cause: 404 }),
        ),
    });

    await expect(service.publicRepository('acme/secret')).rejects.toThrow(
      'No public repository acme/secret on GitHub',
    );
  });

  it('passes other GitHub errors through, a rate limit included', async () => {
    const limited = new BadGatewayException('GitHub returned 403', {
      cause: 403,
    });
    const service = withClient({
      publicRepository: jest.fn().mockRejectedValue(limited),
    });

    await expect(service.publicRepository('acme/api')).rejects.toBe(limited);
  });

  it('says so when a public branch is gone at deploy', async () => {
    const service = withClient({
      branchHead: jest
        .fn()
        .mockRejectedValue(
          new BadGatewayException('GitHub returned 404', { cause: 404 }),
        ),
    });

    await expect(
      service.checkout(undefined, 'acme/api', 'main'),
    ).rejects.toThrow('may have been made private or deleted');
  });

  it('checks a public branch in one request', async () => {
    const hasBranch = jest.fn().mockResolvedValue(true);

    await expect(
      withClient({ hasBranch }).publicBranchExists('acme/api', 'feat/x'),
    ).resolves.toBe(true);
    expect(hasBranch).toHaveBeenCalledWith(undefined, 'acme/api', 'feat/x');
  });

  it('reads a public branch head and branches without a token', async () => {
    const branchHead = jest.fn().mockResolvedValue({ sha: 'c1', message: 'm' });
    const listBranches = jest.fn().mockResolvedValue(['main']);
    const service = withClient({ branchHead, listBranches });

    await expect(
      service.checkout(undefined, 'acme/api', 'main'),
    ).resolves.toEqual({ token: '', sha: 'c1', message: 'm' });
    await expect(service.branches(undefined, 'acme/api')).resolves.toEqual([
      'main',
    ]);
    expect(branchHead).toHaveBeenCalledWith(undefined, 'acme/api', 'main');
    expect(listBranches).toHaveBeenCalledWith(undefined, 'acme/api');
  });
});
