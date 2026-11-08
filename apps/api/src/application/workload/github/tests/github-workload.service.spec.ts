import { BadRequestException } from '@nestjs/common';
import { GithubWorkloadService } from '../github-workload.service';

jest.mock('@/application/integration/github/github.service', () => ({
  GithubService: class GithubService {},
}));
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));
jest.mock('@/application/workload/workload-position', () => ({
  nextWorkloadPosition: () => Promise.resolve({ x: 0, y: 0 }),
  normalizeWorkloadPosition: (value: unknown) => value,
}));

const repositories = [
  { full_name: 'acme/api', default_branch: 'main', installation_id: 1 },
];

const build = () => {
  const values = jest.fn((row: Record<string, unknown>) => ({
    returning: () =>
      Promise.resolve([
        { ...row, created_at: new Date(), updated_at: new Date() },
      ]),
  }));
  const db = { insert: () => ({ values }) };
  const service = new GithubWorkloadService(
    db as never,
    { exists: () => Promise.resolve(true) } as never,
    { repositories: () => Promise.resolve(repositories) } as never,
  );

  return { service, values };
};

describe('GithubWorkloadService.create', () => {
  it('stores the repository as a draft and defaults the branch', async () => {
    const { service, values } = build();
    const created = await service.create('p1', {
      name: 'api',
      type: 'github',
      config: { github_app_id: 'app', repository: 'acme/api' },
    } as never);

    expect(created.status).toBe('draft');
    expect(values.mock.calls[0][0].draft_config).toEqual({
      github_app_id: 'app',
      repository: 'acme/api',
      branch: 'main',
    });
  });

  it('rejects a repository the App cannot reach', async () => {
    const { service } = build();

    await expect(
      service.create('p1', {
        name: 'x',
        type: 'github',
        config: { github_app_id: 'app', repository: 'acme/other' },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
