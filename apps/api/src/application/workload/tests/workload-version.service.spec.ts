import type { WorkloadConfig } from '@acceleratio/shared';
import type { Database } from '@/vendor/db/database.constants';
import {
  sameConfig,
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
