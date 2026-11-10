import { ConflictException } from '@nestjs/common';
import { PassThrough, Readable } from 'node:stream';
import { DockerWorkloadService } from '../../docker/docker-workload.service';
import {
  PUBLISH_TO_CHANGE_FILES_MESSAGE,
  PUBLISHED_RELEASE_MESSAGE,
  StaticWorkloadService,
  UPLOAD_IN_PROGRESS_MESSAGE,
} from '../static-workload.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('@/vendor/seaweedfs/seaweedfs-filer.client', () => ({
  ...jest.requireActual<object>('@/vendor/seaweedfs/seaweedfs-filer.client'),
  SeaweedfsFilerClient: class SeaweedfsFilerClient {},
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

/** A filer response that answers `status` once the request body ends. */
const reply = (status: number, body = '{}') =>
  Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status });

const build = () => {
  const none = {} as never;
  const filer = { request: jest.fn() };
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
    filer as never,
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

  return { service, internals, filer };
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
    const { service, internals, filer } = build();
    const update = jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);

    filer.request.mockImplementation(() => {
      // A settings save lands while the index is checked.
      internals.findRow.mockResolvedValue({
        id: 'w1',
        draft_config: { release_id: live, replicas: 5 },
      });
      return Promise.resolve(reply(200));
    });

    await service.publishRelease('p1', 'w1', next);

    expect(update).toHaveBeenCalledWith('p1', 'w1', {
      config: { release_id: next, replicas: 5 },
    });
  });

  it('refuses while files of the release are uploading', async () => {
    const { service, filer } = build();

    filer.request.mockImplementation(
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

  it('asks the database once per release, not once per file', async () => {
    const { service, internals, filer } = build();

    filer.request.mockImplementation(() => Promise.resolve(reply(201)));

    for (const path of ['index.html', 'app.js', 'app.css']) {
      await upload(service, path);
    }

    expect(internals.versionServes).toHaveBeenCalledTimes(1);
    expect(filer.request).toHaveBeenCalledTimes(3);
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
    const { service, internals, filer } = build();
    let answer: (value: boolean) => void = () => undefined;

    internals.versionServes.mockReturnValue(
      new Promise<boolean>((resolve) => (answer = resolve)),
    );
    filer.request.mockResolvedValue(reply(200));
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
    const { service, filer } = build();

    jest
      .spyOn(DockerWorkloadService.prototype, 'update')
      .mockResolvedValue({ id: 'w1' } as never);
    filer.request.mockResolvedValue(reply(200));
    await service.publishRelease('p1', 'w1', next);

    // The draft was discarded: the database no longer references it.
    filer.request.mockImplementation(() => Promise.resolve(reply(201)));
    await expect(upload(service)).resolves.toBeUndefined();
  });
});

describe('StaticWorkloadService.remove', () => {
  const removable = () => {
    const built = build();
    const kubernetes = {
      coreV1: {
        deleteNamespacedPersistentVolumeClaim: jest.fn().mockResolvedValue({}),
        deletePersistentVolume: jest.fn().mockResolvedValue({}),
      },
    };

    (built.service as unknown as { kubernetes: unknown }).kubernetes =
      kubernetes;
    jest
      .spyOn(DockerWorkloadService.prototype, 'remove')
      .mockResolvedValue(undefined);
    built.internals.findRow.mockResolvedValue({ id: 'w1', project_id: 'p1' });

    return { ...built, kubernetes };
  };

  it('deletes the claim, the volume and every release', async () => {
    const { service, kubernetes, filer } = removable();

    filer.request.mockResolvedValue(reply(200));
    await service.remove('p1', 'w1');

    expect(
      kubernetes.coreV1.deleteNamespacedPersistentVolumeClaim,
    ).toHaveBeenCalledWith({ name: 'static-site-w1', namespace: 'project-p1' });
    expect(kubernetes.coreV1.deletePersistentVolume).toHaveBeenCalledWith({
      name: 'static-site-w1',
    });
    expect(filer.request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'DELETE',
        path: '/sites/w1/',
        query: { recursive: 'true' },
      }),
    );
  });

  it('only logs when the storage cannot be cleaned up', async () => {
    const { service, filer } = removable();

    filer.request.mockRejectedValue(new Error('filer down'));

    await expect(service.remove('p1', 'w1')).resolves.toBeUndefined();
  });
});
