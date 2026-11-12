import { ConflictException } from '@nestjs/common';
import { PassThrough, Readable } from 'node:stream';
import { DockerWorkloadService } from '../../docker/docker-workload.service';
import { runBucketJob } from '../../s3-bucket/rustfs-jobs';
import {
  PUBLISH_TO_CHANGE_FILES_MESSAGE,
  PUBLISHED_RELEASE_MESSAGE,
  StaticWorkloadService,
  UPLOAD_IN_PROGRESS_MESSAGE,
} from '../static-workload.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/vendor/s3/s3.client', () => ({
  S3StorageClient: class S3StorageClient {},
}));
jest.mock('../../s3-bucket/rustfs-jobs', () => ({
  ...jest.requireActual<object>('../../s3-bucket/rustfs-jobs'),
  runBucketJob: jest.fn(),
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

const live = '11111111-1111-4111-8111-111111111111';
const next = '22222222-2222-4222-8222-222222222222';

const build = () => {
  const none = {} as never;
  const s3 = {
    put: jest.fn().mockResolvedValue(1),
    head: jest.fn().mockResolvedValue({ ContentLength: 1 }),
    deletePrefix: jest.fn().mockResolvedValue(0),
  };
  const service = new StaticWorkloadService(
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    none,
    s3 as never,
  );
  const internals = service as unknown as {
    findRow: jest.Mock;
    activeVersion: jest.Mock;
    versionServes: jest.Mock;
  };

  internals.findRow = jest.fn().mockResolvedValue({
    id: 'w1',
    draft_config: null,
  });
  internals.activeVersion = jest
    .fn()
    .mockResolvedValue({ config: { release_id: live, replicas: 3 } });
  internals.versionServes = jest.fn().mockResolvedValue(false);

  return { service, internals, s3 };
};

afterEach(() => jest.restoreAllMocks());

describe('StaticWorkloadService.update', () => {
  it('replaces settings like a Docker service but keeps the release', async () => {
    const { service } = build();
    const update = jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);

    // Replicas back to the default leaves the field out.
    await service.update('p1', 'w1', { config: { cpu_max: 2 } });

    expect(update).toHaveBeenCalledWith('p1', 'w1', {
      config: { cpu_max: 2, release_id: live },
    });
  });

  it('refuses to change the files', async () => {
    const { service } = build();

    await expect(
      service.update('p1', 'w1', { config: { release_id: next } }),
    ).rejects.toThrow(PUBLISH_TO_CHANGE_FILES_MESSAGE);
  });
});

describe('StaticWorkloadService.publishRelease', () => {
  it('keeps the settings read after the index check', async () => {
    const { service, internals, s3 } = build();
    const update = jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);

    s3.head.mockImplementation(() => {
      // A settings save lands while the index is checked.
      internals.findRow.mockResolvedValue({
        id: 'w1',
        draft_config: { release_id: live, replicas: 5 },
      });
      return Promise.resolve({ ContentLength: 1 });
    });

    await service.publishRelease('p1', 'w1', next);

    expect(update).toHaveBeenCalledWith('p1', 'w1', {
      config: { release_id: next, replicas: 5 },
    });
  });

  it('refuses while files of the release are uploading', async () => {
    const { service, s3 } = build();

    s3.put.mockImplementation(
      () => new Promise(() => undefined), // the upload never finishes
    );
    void service.uploadFile(
      'p1',
      'w1',
      next,
      'index.html',
      new PassThrough(),
      undefined,
    );
    await new Promise((resolve) => setImmediate(resolve));

    await expect(service.publishRelease('p1', 'w1', next)).rejects.toThrow(
      UPLOAD_IN_PROGRESS_MESSAGE,
    );
  });
});

describe('StaticWorkloadService.uploadFile', () => {
  const upload = (service: StaticWorkloadService, path = 'app.js') =>
    service.uploadFile(
      'p1',
      'w1',
      next,
      path,
      Readable.from([Buffer.from('x')]),
      undefined,
    );

  it('drops a hidden file without writing it', async () => {
    const { service, s3 } = build();

    await expect(upload(service, '.git/config')).resolves.toBeUndefined();
    expect(s3.put).not.toHaveBeenCalled();
  });

  it('asks the database once per release, not once per file', async () => {
    const { service, internals, s3 } = build();

    for (const path of ['index.html', 'app.js', 'app.css']) {
      await upload(service, path);
    }

    expect(internals.versionServes).toHaveBeenCalledTimes(1);
    expect(s3.put).toHaveBeenCalledTimes(3);
    expect(s3.put).toHaveBeenCalledWith(
      'acceleratio-sites',
      `w1/${next}/index.html`,
      expect.any(Readable),
      'application/octet-stream',
    );
  });

  it('refuses a release the draft serves', async () => {
    const { service, internals } = build();

    internals.findRow.mockResolvedValue({
      id: 'w1',
      draft_config: { release_id: next },
    });

    await expect(upload(service)).rejects.toThrow(
      new ConflictException(PUBLISHED_RELEASE_MESSAGE),
    );
  });

  it('refuses when a publish starts while the database is asked', async () => {
    const { service, internals } = build();
    let answer: (value: boolean) => void = () => undefined;

    internals.versionServes.mockReturnValue(
      new Promise<boolean>((resolve) => (answer = resolve)),
    );
    jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);

    const pending = upload(service);
    await new Promise((resolve) => setImmediate(resolve));
    await service.publishRelease('p1', 'w1', next);
    answer(false); // the read happened before the draft was written

    await expect(pending).rejects.toThrow(PUBLISHED_RELEASE_MESSAGE);
  });

  it('takes files again once a published draft is discarded', async () => {
    const { service } = build();

    jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);
    await service.publishRelease('p1', 'w1', next);

    // The draft was discarded: the database no longer references it.
    await expect(upload(service)).resolves.toBeUndefined();
  });
});

describe('StaticWorkloadService site key', () => {
  it('starts on create and a deploy joins the same attempt', async () => {
    const { service } = build();
    const kubernetes = {
      coreV1: {
        readNamespacedSecret: jest
          .fn()
          .mockRejectedValue(Object.assign(new Error('gone'), { code: 404 })),
        createNamespacedSecret: jest.fn().mockResolvedValue({}),
      },
    };
    let finish: (value: null) => void = () => undefined;

    Object.assign(service as unknown as Record<string, unknown>, {
      kubernetes,
      siteIsolation: { ensure: jest.fn().mockResolvedValue(undefined) },
    });
    jest
      .spyOn(DockerWorkloadService.prototype, 'create')
      .mockResolvedValue({ id: 'w1', name: 'Docs' } as never);
    jest
      .mocked(runBucketJob)
      .mockReset()
      .mockReturnValue(new Promise((resolve) => (finish = resolve)));

    await service.create('p1', { name: 'Docs', type: 'static' });
    await new Promise((resolve) => setImmediate(resolve));

    const deploy = (
      service as unknown as {
        ensureSiteKey(site: object): Promise<void>;
      }
    ).ensureSiteKey({ id: 'w1', project_id: 'p1', name: 'Docs' });

    finish(null);
    await deploy;

    expect(runBucketJob).toHaveBeenCalledTimes(1);
    expect(kubernetes.coreV1.createNamespacedSecret).toHaveBeenCalledTimes(1);
  });
});

describe('StaticWorkloadService.remove', () => {
  const removable = () => {
    const built = build();
    const kubernetes = {
      coreV1: { deleteNamespacedSecret: jest.fn().mockResolvedValue({}) },
    };

    (built.service as unknown as { kubernetes: unknown }).kubernetes =
      kubernetes;
    jest
      .spyOn(DockerWorkloadService.prototype, 'remove')
      .mockResolvedValue(undefined);
    built.internals.findRow.mockResolvedValue({ id: 'w1', project_id: 'p1' });
    jest.mocked(runBucketJob).mockResolvedValue(null);

    return { ...built, kubernetes };
  };

  it('deletes the key and every release', async () => {
    const { service, kubernetes, s3 } = removable();

    await service.remove('p1', 'w1');

    expect(kubernetes.coreV1.deleteNamespacedSecret).toHaveBeenCalledWith({
      name: 'static-site-w1',
      namespace: 'project-p1',
    });
    expect(runBucketJob).toHaveBeenCalledWith(
      kubernetes,
      expect.objectContaining({
        operation: 'delete',
        bucket: 'acceleratio-sites',
        prefix: 'w1/',
      }),
      null,
      expect.any(Number),
    );
    expect(s3.deletePrefix).toHaveBeenCalledWith('acceleratio-sites', 'w1/');
  });

  it('only logs when the storage cannot be cleaned up', async () => {
    const { service, s3 } = removable();

    s3.deletePrefix.mockRejectedValue(new Error('rustfs down'));

    await expect(service.remove('p1', 'w1')).resolves.toBeUndefined();
  });
});
