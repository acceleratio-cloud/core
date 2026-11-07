import type { WorkloadConfig } from '@acceleratio/shared';
import type { Database } from '@/vendor/db/database.constants';
import type { WorkloadVersionRow } from '../schemas/workload-version.schema';
import {
  sameConfig,
  toWorkloadVersion,
  WorkloadVersionService,
} from '../workload-version.service';

const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const versionId = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';

/**
 * A transaction fake that answers the three reads of `record` in order: the
 * locked workload, the latest version number, then the inserted version.
 */
const createDatabase = ({
  draft,
  latest,
}: {
  draft: WorkloadConfig | null;
  latest: number | null;
}) => {
  const forUpdate = jest.fn().mockResolvedValue([{ draft_config: draft }]);
  const latestWhere = jest.fn().mockResolvedValue([{ latest }]);
  const where = jest
    .fn()
    .mockReturnValueOnce({ for: forUpdate })
    .mockImplementationOnce(latestWhere);
  const select = jest.fn().mockReturnValue({ from: () => ({ where }) });
  const insertValues = jest.fn((values: Record<string, unknown>) => ({
    returning: jest
      .fn()
      .mockResolvedValue([{ ...values, created_at: new Date() }]),
  }));
  const set = jest.fn().mockReturnValue({ where: jest.fn() });
  const tx = {
    select,
    insert: jest.fn().mockReturnValue({ values: insertValues }),
    update: jest.fn().mockReturnValue({ set }),
  };
  const db = {
    transaction: jest.fn((run: (client: typeof tx) => unknown) => run(tx)),
  } as unknown as Database;

  return { db, insertValues, set, forUpdate };
};

describe('sameConfig', () => {
  it('ignores key order', () => {
    expect(
      sameConfig(
        { docker_image: 'nginx', b: 1, a: 2 } as unknown as WorkloadConfig,
        { a: 2, docker_image: 'nginx', b: 1 } as unknown as WorkloadConfig,
      ),
    ).toBe(true);
  });

  it('tells a missing config from a present one', () => {
    expect(sameConfig(null, { docker_image: 'nginx' })).toBe(false);
    expect(sameConfig(null, undefined)).toBe(true);
  });
});

describe('WorkloadVersionService.record', () => {
  const applied: WorkloadConfig = { docker_image: 'nginx:1.26' };

  it('numbers the version after the latest one and clears the applied draft', async () => {
    const { db, insertValues, set, forUpdate } = createDatabase({
      draft: applied,
      latest: 2,
    });
    const service = new WorkloadVersionService(db);

    const version = await service.record({
      id: versionId,
      workloadId,
      config: applied,
      appliedDraft: applied,
    });

    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(insertValues).toHaveBeenCalledWith({
      id: versionId,
      workload_id: workloadId,
      number: 3,
      config: applied,
      source_version_id: null,
      created_by_id: null,
      created_by_name: null,
      created_by_email: null,
    });
    expect(version.number).toBe(3);
    expect(set).toHaveBeenCalledWith({
      active_version_id: versionId,
      draft_config: null,
    });
  });

  it('starts at 1 for a workload without versions', async () => {
    const { db, insertValues } = createDatabase({
      draft: applied,
      latest: null,
    });

    await new WorkloadVersionService(db).record({
      id: versionId,
      workloadId,
      config: applied,
      appliedDraft: applied,
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ number: 1 }),
    );
  });

  it('keeps a draft that was edited while the deploy ran', async () => {
    const { db, set } = createDatabase({
      draft: { docker_image: 'nginx:1.27' },
      latest: 2,
    });

    await new WorkloadVersionService(db).record({
      id: versionId,
      workloadId,
      config: applied,
      appliedDraft: applied,
    });

    expect(set).toHaveBeenCalledWith({ active_version_id: versionId });
  });

  it('leaves the draft alone on a rollback', async () => {
    const { db, set, insertValues } = createDatabase({
      draft: applied,
      latest: 3,
    });
    const sourceVersionId = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e';

    await new WorkloadVersionService(db).record({
      id: versionId,
      workloadId,
      config: { docker_image: 'nginx:1.24' },
      sourceVersionId,
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 4,
        source_version_id: sourceVersionId,
      }),
    );
    expect(set).toHaveBeenCalledWith({ active_version_id: versionId });
  });
});

describe('WorkloadVersionService authors', () => {
  it('records who applied the version', async () => {
    const { db, insertValues } = createDatabase({ draft: null, latest: 0 });

    await new WorkloadVersionService(db).record({
      id: versionId,
      workloadId,
      config: { docker_image: 'nginx' },
      author: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
    });

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        created_by_id: 'user-1',
        created_by_name: 'Ada',
        created_by_email: 'ada@example.com',
      }),
    );
  });

  const row: WorkloadVersionRow = {
    id: versionId,
    workload_id: workloadId,
    number: 1,
    config: { docker_image: 'nginx' },
    source_version_id: null,
    created_by_id: null,
    created_by_name: 'Ada',
    created_by_email: 'ada@example.com',
    created_at: new Date('2026-11-01T10:00:00.000Z'),
  };

  it('keeps the author of a deleted account', () => {
    expect(toWorkloadVersion(row).created_by).toEqual({
      id: null,
      name: 'Ada',
      email: 'ada@example.com',
    });
  });

  it('has no author for versions from before authors were recorded', () => {
    expect(
      toWorkloadVersion({
        ...row,
        created_by_name: null,
        created_by_email: null,
      }).created_by,
    ).toBeNull();
  });
});

describe('WorkloadVersionService.resolveSide', () => {
  const activeId = '6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e';
  const version = (id: string, number: number): WorkloadVersionRow => ({
    id,
    workload_id: workloadId,
    number,
    config: { docker_image: `nginx:${number}` },
    source_version_id: null,
    created_by_id: null,
    created_by_name: null,
    created_by_email: null,
    created_at: new Date(),
  });
  const createService = () => {
    const service = new WorkloadVersionService({} as Database);
    const get = jest
      .spyOn(service, 'get')
      .mockImplementation((_workload, id) =>
        Promise.resolve(version(id, id === activeId ? 2 : 1)),
      );

    return { service, get };
  };
  const deployed = {
    id: workloadId,
    active_version_id: activeId,
    draft_config: null,
  };

  it('resolves the active version', async () => {
    const { service, get } = createService();

    await expect(service.resolveSide(deployed, 'active')).resolves.toEqual({
      side: { kind: 'version', version_id: activeId, number: 2 },
      config: { docker_image: 'nginx:2' },
    });
    expect(get).toHaveBeenCalledWith(workloadId, activeId);
  });

  it('resolves the draft, or the active version when there is none', async () => {
    const { service } = createService();
    const draft: WorkloadConfig = { docker_image: 'nginx:3' };

    await expect(
      service.resolveSide({ ...deployed, draft_config: draft }, 'draft'),
    ).resolves.toEqual({ side: { kind: 'draft' }, config: draft });
    await expect(service.resolveSide(deployed, 'draft')).resolves.toEqual(
      expect.objectContaining({
        side: { kind: 'version', version_id: activeId, number: 2 },
      }),
    );
  });

  it('has nothing on the active side before the first deploy', async () => {
    const { service, get } = createService();

    await expect(
      service.resolveSide({ ...deployed, active_version_id: null }, 'active'),
    ).resolves.toEqual({ side: { kind: 'none' }, config: null });
    expect(get).not.toHaveBeenCalled();
  });

  it('resolves a version id of the workload', async () => {
    const { service, get } = createService();

    await service.resolveSide(deployed, versionId);

    expect(get).toHaveBeenCalledWith(workloadId, versionId);
  });

  it('rejects anything else before it reaches the database', async () => {
    const { service, get } = createService();

    await expect(service.resolveSide(deployed, 'latest')).rejects.toThrow(
      'A version must be "active", "draft" or a version id',
    );
    expect(get).not.toHaveBeenCalled();
  });
});
