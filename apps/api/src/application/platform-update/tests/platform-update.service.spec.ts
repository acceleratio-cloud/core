import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Database } from '@/vendor/db/database.constants';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import type { PlatformReleaseService } from '../platform-release.service';
import {
  DEV_BUILD_MESSAGE,
  NOT_STARTED_MESSAGE,
  PlatformUpdateService,
  UNKNOWN_RELEASE_MESSAGE,
  UPDATE_IN_PROGRESS_MESSAGE,
} from '../platform-update.service';
import type { PlatformVersionService } from '../platform-version.service';
import type {
  PlatformUpdateRow,
  StoredRelease,
} from '../schemas/platform-update.schema';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('../platform-version.service', () => ({
  PlatformVersionService: class PlatformVersionService {},
}));
jest.mock('../platform-release.service', () => ({
  PlatformReleaseService: class PlatformReleaseService {},
}));

const id = '0b8f6c1e-4d2a-4c55-9a1e-2f3c4d5e6f70';
const name = 'platform-update-0b8f6c1e4d2a';

const clusterError = (code: number) =>
  Object.assign(new Error(`Kubernetes ${code}`), { code, body: {} });

const runningRow = (
  overrides: Partial<PlatformUpdateRow> = {},
): PlatformUpdateRow => ({
  id,
  from_version: '0.1.6',
  to_version: '0.1.7',
  status: 'running',
  stage: 'launch',
  message: null,
  log: '',
  external_name: name,
  actor: 'admin@example.com',
  started_at: new Date(),
  reported_at: null,
  finished_at: null,
  updated_at: new Date(),
  ...overrides,
});

const release: StoredRelease = {
  version: '0.1.7',
  tag: 'v0.1.7',
  name: 'Acceleratio 0.1.7',
  notes: '',
  url: '',
  published_at: null,
  checksums_url: 'https://example.com/SHA256SUMS',
};

const createService = (rows: PlatformUpdateRow[]) => {
  const updates: Record<string, unknown>[] = [];
  const limit = jest.fn().mockResolvedValue(rows);
  const where = jest.fn().mockReturnValue({ limit });
  const select = jest.fn().mockReturnValue({
    from: jest.fn().mockReturnValue({ where }),
  });
  const update = jest.fn().mockReturnValue({
    set: jest.fn().mockImplementation((values: Record<string, unknown>) => {
      updates.push(values);
      return {
        where: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([{ ...rows[0], ...values }]),
        }),
      };
    }),
  });
  const insert = jest.fn();

  const coreV1 = {
    readNamespacedConfigMap: jest.fn(),
    deleteNamespacedConfigMap: jest.fn().mockResolvedValue({}),
    listNamespacedPod: jest
      .fn()
      .mockResolvedValue({ items: [{ metadata: { name: `${name}-abcde` } }] }),
    readNamespacedPodLog: jest.fn(),
  };
  const batchV1 = {
    readNamespacedJob: jest.fn(),
    createNamespacedJob: jest.fn(),
  };
  const versions = {
    namespace: 'acceleratio',
    inCluster: true,
    currentVersion: jest.fn().mockResolvedValue('0.1.6'),
    readApiImage: jest
      .fn()
      .mockResolvedValue('ghcr.io/acceleratio-cloud/api:0.1.6'),
    installationNode: jest.fn().mockResolvedValue('server-1'),
    invalidate: jest.fn(),
  };
  const releases = {
    repository: 'acceleratio-cloud/core',
    find: jest.fn().mockResolvedValue(release),
    checksums: jest.fn().mockResolvedValue({
      updateSha256: 'a'.repeat(64),
      installSha256: 'b'.repeat(64),
    }),
  };

  const service = new PlatformUpdateService(
    { select, update, insert } as unknown as Database,
    { coreV1, batchV1 } as unknown as KubernetesService,
    releases as unknown as PlatformReleaseService,
    versions as unknown as PlatformVersionService,
  );

  return { service, updates, coreV1, batchV1, versions, releases, insert };
};

describe('PlatformUpdateService.poll', () => {
  it('copies the reported progress while the update runs', async () => {
    const { service, updates, coreV1 } = createService([runningRow()]);
    coreV1.readNamespacedConfigMap.mockResolvedValue({
      data: {
        status:
          'phase=running\nstage=install\nexit_code=\nmessage=Installing Cilium (networking)\nreported_at=2026-11-07T10:00:00Z\n',
        log: '\u001b[34m[10:00:00]\u001b[0m Backing up\n',
      },
    });

    // A report a minute old, whatever day the suite runs: an older one would
    // trip the silence timeout and end the update.
    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-11-07T10:01:00Z').getTime());

    try {
      await expect(service.poll(id)).resolves.toBe(false);
    } finally {
      now.mockRestore();
    }

    expect(updates).toEqual([
      {
        stage: 'install',
        message: 'Installing Cilium (networking)',
        log: '[10:00:00] Backing up\n',
        reported_at: new Date('2026-11-07T10:00:00Z'),
      },
    ]);
    expect(coreV1.deleteNamespacedConfigMap).not.toHaveBeenCalled();
  });

  it('finishes the update with the reported outcome and removes the status', async () => {
    const { service, updates, coreV1, versions } = createService([
      runningRow(),
    ]);
    coreV1.readNamespacedConfigMap.mockResolvedValue({
      data: {
        status:
          'phase=rolled_back\nstage=rollback\nexit_code=1\nmessage=Restored 0.1.6\nreported_at=2026-11-07T10:05:00Z\n',
        log: 'log',
      },
    });

    await expect(service.poll(id)).resolves.toBe(true);
    expect(updates[0]).toMatchObject({
      status: 'rolled_back',
      stage: 'rollback',
      message: 'Restored 0.1.6',
      log: 'log',
    });
    expect(updates[0].finished_at).toBeInstanceOf(Date);
    expect(coreV1.deleteNamespacedConfigMap).toHaveBeenCalledWith({
      name,
      namespace: 'acceleratio',
    });
    expect(versions.invalidate).toHaveBeenCalled();
  });

  it('marks a success as done', async () => {
    const { service, updates, coreV1 } = createService([runningRow()]);
    coreV1.readNamespacedConfigMap.mockResolvedValue({
      data: { status: 'phase=succeeded\nstage=done\nexit_code=0\n', log: '' },
    });

    await expect(service.poll(id)).resolves.toBe(true);
    expect(updates[0]).toMatchObject({ status: 'succeeded', stage: 'done' });
  });

  it('reports why the launcher failed', async () => {
    const { service, updates, coreV1, batchV1 } = createService([runningRow()]);
    coreV1.readNamespacedConfigMap.mockRejectedValue(clusterError(404));
    batchV1.readNamespacedJob.mockResolvedValue({ status: { failed: 1 } });
    coreV1.readNamespacedPodLog.mockResolvedValue(
      'ERROR: Another update is already running on server-1 (acceleratio-update.service).\n',
    );

    await expect(service.poll(id)).resolves.toBe(true);
    expect(updates[0]).toMatchObject({
      status: 'failed',
      stage: 'launch',
      message:
        'The update could not be started on the server: Another update is already running on server-1 (acceleratio-update.service).',
    });
  });

  it('keeps waiting for a launcher that just started', async () => {
    const { service, updates, coreV1, batchV1 } = createService([runningRow()]);
    coreV1.readNamespacedConfigMap.mockRejectedValue(clusterError(404));
    batchV1.readNamespacedJob.mockResolvedValue({ status: { active: 1 } });

    await expect(service.poll(id)).resolves.toBe(false);
    expect(updates).toEqual([]);
  });

  it('gives up when the server never reported', async () => {
    const { service, updates, coreV1, batchV1 } = createService([
      runningRow({ started_at: new Date(Date.now() - 11 * 60 * 1000) }),
    ]);
    coreV1.readNamespacedConfigMap.mockRejectedValue(clusterError(404));
    batchV1.readNamespacedJob.mockResolvedValue({ status: { succeeded: 1 } });

    await expect(service.poll(id)).resolves.toBe(true);
    expect(updates[0]).toMatchObject({
      status: 'failed',
      message: NOT_STARTED_MESSAGE,
    });
  });

  it('keeps the row while the cluster does not answer', async () => {
    const { service, updates, coreV1 } = createService([runningRow()]);
    coreV1.readNamespacedConfigMap.mockRejectedValue(clusterError(503));

    await expect(service.poll(id)).resolves.toBe(false);
    expect(updates).toEqual([]);
  });

  it('stops polling a finished update', async () => {
    const { service, coreV1 } = createService([
      runningRow({ status: 'succeeded' }),
    ]);

    await expect(service.poll(id)).resolves.toBe(true);
    expect(coreV1.readNamespacedConfigMap).not.toHaveBeenCalled();
  });
});

describe('PlatformUpdateService.start', () => {
  it('refuses a development build', async () => {
    const { service, versions, insert } = createService([]);
    versions.currentVersion.mockResolvedValue(null);

    await expect(service.start({ version: '0.1.7' }, null)).rejects.toThrow(
      new BadRequestException(DEV_BUILD_MESSAGE),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses a second update while one runs', async () => {
    const { service, insert } = createService([runningRow()]);

    await expect(service.start({ version: '0.1.7' }, null)).rejects.toThrow(
      new ConflictException(UPDATE_IN_PROGRESS_MESSAGE),
    );
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses versions that are not a newer listed release', async () => {
    const { service, releases, insert } = createService([]);

    await expect(service.start({ version: 'latest' }, null)).rejects.toThrow(
      BadRequestException,
    );

    releases.find.mockResolvedValue(null);
    await expect(service.start({ version: '0.1.8' }, null)).rejects.toThrow(
      new BadRequestException(UNKNOWN_RELEASE_MESSAGE),
    );

    releases.find.mockResolvedValue({ ...release, version: '0.1.6' });
    await expect(service.start({ version: '0.1.6' }, null)).rejects.toThrow(
      new BadRequestException(UNKNOWN_RELEASE_MESSAGE),
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
