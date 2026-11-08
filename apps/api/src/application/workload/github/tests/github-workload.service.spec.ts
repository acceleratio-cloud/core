import { BadRequestException } from '@nestjs/common';
import { DockerWorkloadService } from '../../docker/docker-workload.service';
import {
  RAILPACK_FRONTEND,
  buildJob,
  buildPolicy,
  buildScript,
} from '../github-build.manifests';
import { GithubWorkloadService, pushAuthor } from '../github-workload.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/application/integration/github/github.service', () => ({
  GithubService: class GithubService {},
}));
jest.mock('@/application/project/project.service', () => ({
  ProjectService: class ProjectService {},
}));
jest.mock('@/application/project/project-isolation.service', () => ({
  ProjectIsolationService: class ProjectIsolationService {},
}));
jest.mock('@/application/storage-class/storage-class.service', () => ({
  StorageClassService: class StorageClassService {},
}));

const source = {
  github_app_id: 'app',
  repository: 'acme/api',
  branch: 'main',
};
const image = `registry.acceleratio.internal/p1/w1@sha256:${'a'.repeat(64)}`;

const build = (github: Record<string, jest.Mock> = {}) => {
  const none = {} as never;
  const service = new GithubWorkloadService(
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    github as never,
  );
  const internals = service as unknown as {
    normalizeConfig: (config: unknown) => Record<string, unknown>;
    findRow: jest.Mock;
    activeVersion: jest.Mock;
    exclusive: (id: string, run: () => Promise<unknown>) => Promise<unknown>;
    runningBuild: jest.Mock;
    withLatest: jest.Mock;
    get: jest.Mock;
  };

  internals.exclusive = (_id, run) => run();
  internals.activeVersion = jest.fn().mockResolvedValue(null);
  internals.runningBuild = jest.fn().mockResolvedValue(false);
  internals.withLatest = jest.fn((item: unknown) => Promise.resolve(item));
  internals.get = jest.fn().mockResolvedValue({ id: 'w1' });

  return { service, internals };
};

afterEach(() => jest.restoreAllMocks());

describe('GithubWorkloadService config', () => {
  it('keeps the source and leaves the image out until a build', () => {
    const { internals } = build();

    expect(internals.normalizeConfig({ ...source, replicas: 2 })).toEqual({
      ...source,
      replicas: 2,
    });
  });

  it('keeps the built image and commit', () => {
    const { internals } = build();

    expect(
      internals.normalizeConfig({
        ...source,
        docker_image: image,
        commit_sha: 'c1',
      }),
    ).toEqual({ ...source, docker_image: image, commit_sha: 'c1' });
  });

  it('drops an entrypoint or command: the built image decides', () => {
    const { internals } = build();

    expect(
      internals.normalizeConfig({
        ...source,
        entrypoint: ['sh'],
        command: ['-c', 'run'],
      }),
    ).toEqual(source);
  });

  it('requires the source', () => {
    const { internals } = build();

    expect(() => internals.normalizeConfig({ github_app_id: 'app' })).toThrow(
      BadRequestException,
    );
  });

  it('ignores a requested source, image or commit on update', async () => {
    const { service, internals } = build();
    const update = jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);

    internals.findRow = jest.fn().mockResolvedValue({
      id: 'w1',
      draft_config: { ...source, docker_image: image, commit_sha: 'c1' },
    });

    await service.update('p1', 'w1', {
      config: {
        ...source,
        repository: 'evil/other',
        docker_image: 'evil:latest',
        commit_sha: 'c2',
        replicas: 3,
      },
    });

    expect(update.mock.calls[0][2].config).toEqual({
      ...source,
      replicas: 3,
      docker_image: image,
      commit_sha: 'c1',
    });
  });

  it('switches to an existing branch and keeps the image', async () => {
    const branches = jest.fn().mockResolvedValue(['main', 'dev']);
    const { service, internals } = build({ branches });
    const update = jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);

    internals.findRow = jest.fn().mockResolvedValue({
      id: 'w1',
      draft_config: { ...source, docker_image: image, commit_sha: 'c1' },
    });

    await service.update('p1', 'w1', { config: { ...source, branch: 'dev' } });

    expect(branches).toHaveBeenCalledWith('app', 'acme/api');
    expect(update.mock.calls[0][2].config).toEqual({
      ...source,
      branch: 'dev',
      docker_image: image,
      commit_sha: 'c1',
    });
  });

  it('refuses a branch the repository does not have', async () => {
    const { service, internals } = build({
      branches: jest.fn().mockResolvedValue(['main']),
    });
    const update = jest.spyOn(DockerWorkloadService.prototype, 'update');

    internals.findRow = jest.fn().mockResolvedValue({
      id: 'w1',
      draft_config: source,
    });

    await expect(
      service.update('p1', 'w1', { config: { ...source, branch: 'gone' } }),
    ).rejects.toThrow('Branch gone does not exist in acme/api');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('GithubWorkloadService.deploy', () => {
  it('deploys at once when the image comes from the branch head', async () => {
    const checkout = jest
      .fn()
      .mockResolvedValue({ token: 't', sha: 'c1', message: 'm' });
    const { service, internals } = build({ checkout });
    const deploy = jest
      .spyOn(DockerWorkloadService.prototype, 'deploy')
      .mockResolvedValue({ id: 'w1' } as never);

    internals.findRow = jest.fn().mockResolvedValue({
      id: 'w1',
      project_id: 'p1',
      draft_config: { ...source, docker_image: image, commit_sha: 'c1' },
    });

    await service.deploy('p1', 'w1', null);

    expect(checkout).toHaveBeenCalledWith('app', 'acme/api', 'main');
    expect(deploy).toHaveBeenCalledWith('p1', 'w1', null);
  });

  it('refuses a second build while one runs', async () => {
    const { service, internals } = build();

    internals.findRow = jest.fn().mockResolvedValue({ id: 'w1' });
    internals.runningBuild = jest.fn().mockResolvedValue(true);

    await expect(service.deploy('p1', 'w1')).rejects.toThrow('already running');
  });
});

describe('build manifests', () => {
  const input = {
    buildId: 'b1',
    workloadId: 'w1',
    name: 'build-b1',
    namespace: 'acceleratio-builds',
    repository: 'acme/api',
    commitSha: 'c1',
    imageRepository: 'p1/w1',
  };

  it('builds the commit without a service account token', () => {
    const job = buildJob(input);
    const pod = job.spec!.template.spec!;
    const env = Object.fromEntries(
      pod.containers[0].env!.map((item) => [item.name, item]),
    );

    expect(pod.automountServiceAccountToken).toBe(false);
    expect(job.spec!.backoffLimit).toBe(0);
    expect(env.BUILD_REPOSITORY.value).toBe('https://github.com/acme/api.git');
    expect(env.BUILD_COMMIT.value).toBe('c1');
    expect(env.BUILD_IMAGE.value).toBe(
      'registry.acceleratio.svc.cluster.local:5000/p1/w1:c1',
    );
    // The token reaches BuildKit only as a secret, never as a value.
    expect(env.GIT_AUTH_TOKEN.value).toBeUndefined();
    expect(env.GIT_AUTH_TOKEN.valueFrom?.secretKeyRef?.name).toBe('build-b1');
  });

  it('writes the image digest to the termination message', () => {
    expect(buildScript()).toContain('/dev/termination-log');
  });

  it('builds the Dockerfile, or a checksummed Railpack plan without one', () => {
    const script = buildScript();

    expect(script).toContain('if [ -f src/Dockerfile ]');
    expect(script).toContain('--frontend dockerfile.v0');
    expect(script).toContain('railpack prepare src');
    expect(script).toContain(
      `--frontend gateway.v0 --opt source=${RAILPACK_FRONTEND}`,
    );
    expect(script).toContain('sha256sum -c');
  });

  it('fetches with the token only in a github.com header and drops .git', () => {
    const script = buildScript();

    expect(script).toContain(
      'auth="http.https://github.com/.extraHeader=Authorization: Basic',
    );
    expect(script).toContain(
      '-c "$auth" submodule update -q --init --recursive',
    );
    expect(script).not.toMatch(/https:\/\/[^"\s]*\$GIT_AUTH_TOKEN/);
    expect(script).toContain('rm -rf src/.git');
    expect(script.indexOf('unset GIT_AUTH_TOKEN')).toBeLessThan(
      script.indexOf('git init'),
    );
  });

  it('lets builds reach only DNS, the registry and the internet', () => {
    const policy = buildPolicy('acceleratio-builds');

    expect(policy.spec.ingress).toEqual([]);
    expect(policy.spec.egress[1].toEndpoints?.[0].matchLabels).toMatchObject({
      'k8s:io.kubernetes.pod.namespace': 'acceleratio',
      'app.kubernetes.io/name': 'registry',
    });
    expect(policy.spec.egress[2]).toEqual({ toEntities: ['world'] });
  });
});

/** A `db.select()` whose chains resolve to the queued results, in order. */
const queuedDb = (...results: unknown[][]) => {
  const chain = (result: unknown[]) => {
    const node: Record<string, unknown> = {};
    for (const key of ['from', 'where', 'limit', 'orderBy']) {
      node[key] = () => node;
    }
    node.then = (resolve: (value: unknown) => unknown) => resolve(result);
    return node;
  };

  return { select: jest.fn(() => chain(results.shift() ?? [])) };
};

describe('GithubWorkloadService.handlePush', () => {
  const deployed = (id: string, config: Record<string, unknown>) => ({
    id,
    name: id,
    project_id: 'p1',
    draft_config: config,
  });

  const run = async (
    payload: Record<string, unknown>,
    running?: { id: string },
  ) => {
    const { service } = build();
    const rows = [
      deployed('follows', source),
      deployed('other-branch', { ...source, branch: 'dev' }),
      deployed('other-repo', { ...source, repository: 'acme/web' }),
      deployed('other-app', { ...source, github_app_id: 'app2' }),
    ];
    const deploy = jest.spyOn(service, 'deploy').mockResolvedValue({} as never);
    const stopBuild = jest.fn().mockResolvedValue(undefined);

    Object.assign(service, {
      db: queuedDb(rows),
      runningBuildRow: jest.fn().mockResolvedValue(running),
      stopBuild,
    });

    await service.handlePush('app', payload);

    return { deploy, stopBuild };
  };

  const push = {
    ref: 'refs/heads/main',
    repository: { full_name: 'acme/api' },
  };

  it('deploys only the services that follow the pushed branch', async () => {
    const { deploy, stopBuild } = await run(push);

    expect(deploy.mock.calls).toEqual([['p1', 'follows', null]]);
    expect(stopBuild).not.toHaveBeenCalled();
  });

  it('cancels a build of an older commit first', async () => {
    const { deploy, stopBuild } = await run(push, { id: 'b-old' });

    expect(stopBuild).toHaveBeenCalledWith(
      'p1',
      { id: 'b-old' },
      'Superseded by a newer push',
    );
    expect(deploy).toHaveBeenCalledTimes(1);
  });

  it('ignores tags and deleted branches', async () => {
    expect(
      (await run({ ...push, ref: 'refs/tags/v1' })).deploy,
    ).not.toHaveBeenCalled();
    expect(
      (await run({ ...push, deleted: true })).deploy,
    ).not.toHaveBeenCalled();
  });
});

describe('GithubWorkloadService.pollBuild', () => {
  it('does not deploy a build that was cancelled while it finished', async () => {
    const { service } = build();
    const digest = `sha256:${'b'.repeat(64)}`;
    const deployImage = jest.fn();

    Object.assign(service, {
      db: queuedDb(
        [
          {
            id: 'b1',
            workload_id: 'w1',
            status: 'building',
            external_name: 'build-b1',
            created_at: new Date(),
          },
        ],
        [{ project_id: 'p1' }],
      ),
      kubernetes: {
        batchV1: {
          readNamespacedJob: jest
            .fn()
            .mockResolvedValue({ status: { succeeded: 1 } }),
        },
      },
      readPod: jest.fn().mockResolvedValue({ log: 'done', digest }),
      // The cancel got there first.
      finishBuild: jest.fn().mockResolvedValue(false),
      deployImage,
    });

    await expect(service.pollBuild('b1')).resolves.toBe(true);
    expect(deployImage).not.toHaveBeenCalled();
  });
});

describe('pushAuthor', () => {
  it('credits the GitHub account that pushed', () => {
    expect(
      pushAuthor({
        sender: { login: 'octo-cat' },
        pusher: { name: 'octo-cat', email: 'octo@example.com' },
      }),
    ).toEqual({
      id: null,
      name: 'octo-cat',
      email: 'octo@example.com',
      github_login: 'octo-cat',
    });
  });

  it('uses the noreply address when the email is private', () => {
    expect(
      pushAuthor({ sender: { login: 'octo' }, pusher: { email: null } })?.email,
    ).toBe('octo@users.noreply.github.com');
  });

  it('refuses a login that is not one, since it becomes a link', () => {
    for (const login of ['../evil', 'a--b', '-a', 'x'.repeat(40), '']) {
      expect(pushAuthor({ sender: { login } })).toBeNull();
    }
  });
});
