import { Readable } from 'node:stream';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { S3StorageClient } from '@/vendor/s3/s3.client';
import type { S3BucketWorkloadService } from '../s3-bucket.service';
import {
  contentDisposition,
  S3BucketObjectsService,
  sortEntries,
} from '../s3-bucket-objects.service';

// Both pull the ESM-only Kubernetes client; every instance here is faked.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('../s3-bucket.service', () => ({
  S3BucketWorkloadService: class S3BucketWorkloadService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';

const createService = (status: 'running' | 'deploying' = 'running') => {
  const s3 = {
    list: jest.fn().mockResolvedValue({ Contents: [], CommonPrefixes: [] }),
    head: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
    put: jest.fn().mockResolvedValue(0),
    delete: jest.fn().mockResolvedValue(undefined),
    deletePrefix: jest.fn().mockResolvedValue(0),
  };
  const buckets = {
    readyBucket: jest.fn(() =>
      status === 'running'
        ? Promise.resolve('demo-assets')
        : Promise.reject(
            new ConflictException('The bucket is still being created'),
          ),
    ),
  };
  const service = new S3BucketObjectsService(
    buckets as unknown as S3BucketWorkloadService,
    s3 as unknown as S3StorageClient,
  );

  return { service, s3 };
};

describe('S3BucketObjectsService.list', () => {
  it('lists one folder, folders first, as keys from the bucket root', async () => {
    const { service, s3 } = createService();

    s3.list.mockResolvedValue({
      CommonPrefixes: [{ Prefix: 'docs/2026/' }],
      Contents: [
        { Key: 'docs/', Size: 0 },
        {
          Key: 'docs/report 10.pdf',
          Size: 2048,
          LastModified: new Date('2026-11-04T10:00:00Z'),
        },
        { Key: 'docs/report 9.pdf', Size: 10 },
      ],
      IsTruncated: true,
    });

    await expect(service.list(projectId, workloadId, '/docs')).resolves.toEqual(
      {
        prefix: 'docs/',
        truncated: true,
        entries: [
          {
            name: '2026',
            path: 'docs/2026/',
            kind: 'folder',
            size: null,
            content_type: null,
            modified_at: null,
          },
          {
            name: 'report 9.pdf',
            path: 'docs/report 9.pdf',
            kind: 'file',
            size: 10,
            content_type: null,
            modified_at: null,
          },
          {
            name: 'report 10.pdf',
            path: 'docs/report 10.pdf',
            kind: 'file',
            size: 2048,
            content_type: null,
            modified_at: '2026-11-04T10:00:00.000Z',
          },
        ],
      },
    );
    expect(s3.list).toHaveBeenCalledWith('demo-assets', 'docs/', {
      delimiter: '/',
      maxKeys: 1000,
    });
  });

  it('lists an empty bucket root', async () => {
    const { service } = createService();

    await expect(service.list(projectId, workloadId, '')).resolves.toEqual({
      prefix: '',
      entries: [],
      truncated: false,
    });
  });

  it('reports a missing folder as 404', async () => {
    const { service } = createService();

    await expect(
      service.list(projectId, workloadId, 'missing/'),
    ).rejects.toThrow(new NotFoundException('Folder not found'));
  });

  it('passes an unreachable store on as 502', async () => {
    const { service, s3 } = createService();

    s3.list.mockRejectedValue(
      new BadGatewayException('Object storage could not list the folder'),
    );

    await expect(service.list(projectId, workloadId, '')).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('refuses a bucket that is not ready', async () => {
    const { service, s3 } = createService('deploying');

    await expect(service.list(projectId, workloadId, '')).rejects.toThrow(
      'The bucket is still being created',
    );
    expect(s3.list).not.toHaveBeenCalled();
  });
});

describe('S3BucketObjectsService.createFolder', () => {
  it('writes an empty marker object when the name is free', async () => {
    const { service, s3 } = createService();

    await expect(
      service.createFolder(projectId, workloadId, 'docs/new'),
    ).resolves.toMatchObject({
      name: 'new',
      path: 'docs/new/',
      kind: 'folder',
    });
    expect(s3.head).toHaveBeenCalledWith('demo-assets', 'docs/new');
    expect(s3.put).toHaveBeenCalledWith(
      'demo-assets',
      'docs/new/',
      Buffer.alloc(0),
      'application/octet-stream',
    );
  });

  it('refuses a name a file or folder already has', async () => {
    const { service, s3 } = createService();

    s3.head.mockResolvedValueOnce({ ContentLength: 3 });
    await expect(
      service.createFolder(projectId, workloadId, 'docs'),
    ).rejects.toThrow(ConflictException);

    s3.list.mockResolvedValueOnce({ Contents: [{ Key: 'docs/a.txt' }] });
    await expect(
      service.createFolder(projectId, workloadId, 'docs'),
    ).rejects.toThrow(ConflictException);
    expect(s3.put).not.toHaveBeenCalled();
  });

  it('validates the path before calling S3', async () => {
    const { service, s3 } = createService();

    await expect(
      service.createFolder(projectId, workloadId, 'a/../b'),
    ).rejects.toThrow(BadRequestException);
    expect(s3.head).not.toHaveBeenCalled();
  });
});

describe('S3BucketObjectsService.upload', () => {
  it('streams the body to its key with its content type', async () => {
    const { service, s3 } = createService();
    const body = Readable.from(['hello']);

    s3.put.mockResolvedValue(5);

    await expect(
      service.upload(projectId, workloadId, 'docs/a.txt', body, 'text/plain'),
    ).resolves.toMatchObject({
      name: 'a.txt',
      path: 'docs/a.txt',
      kind: 'file',
      size: 5,
      content_type: 'text/plain',
    });
    expect(s3.put).toHaveBeenCalledWith(
      'demo-assets',
      'docs/a.txt',
      body,
      'text/plain',
    );
  });

  it('refuses a folder key', async () => {
    const { service, s3 } = createService();

    await expect(
      service.upload(projectId, workloadId, 'docs/', Readable.from([]), ''),
    ).rejects.toThrow('File path cannot end with /');
    expect(s3.put).not.toHaveBeenCalled();
  });
});

describe('S3BucketObjectsService.download', () => {
  it('streams the file with its type and length', async () => {
    const { service, s3 } = createService();
    const body = Readable.from(['hello']);

    s3.get.mockResolvedValue({
      Body: body,
      ContentType: 'text/plain',
      ContentLength: 5,
    });

    await expect(
      service.download(projectId, workloadId, 'docs/a.txt'),
    ).resolves.toEqual({
      name: 'a.txt',
      contentType: 'text/plain',
      contentLength: 5,
      body,
    });
  });

  it('refuses a folder and a missing file', async () => {
    const { service, s3 } = createService();

    s3.list.mockResolvedValueOnce({ Contents: [{ Key: 'docs/a.txt' }] });
    await expect(
      service.download(projectId, workloadId, 'docs'),
    ).rejects.toThrow(new BadRequestException('This path is a folder'));
    await expect(
      service.download(projectId, workloadId, 'missing.txt'),
    ).rejects.toThrow(new NotFoundException('File not found'));
  });
});

describe('S3BucketObjectsService.remove', () => {
  it('deletes a folder with its contents', async () => {
    const { service, s3 } = createService();

    s3.deletePrefix.mockResolvedValue(3);

    await service.remove(projectId, workloadId, 'docs', 'folder');
    expect(s3.deletePrefix).toHaveBeenCalledWith('demo-assets', 'docs/');
  });

  it('deletes one file and nothing that only starts with its name', async () => {
    const { service, s3 } = createService();

    s3.head.mockResolvedValue({ ContentLength: 3 });

    await service.remove(projectId, workloadId, 'docs/a.txt', 'file');
    expect(s3.delete).toHaveBeenCalledWith('demo-assets', 'docs/a.txt');
    expect(s3.deletePrefix).not.toHaveBeenCalled();
  });

  it('reports what is not there as 404', async () => {
    const { service } = createService();

    await expect(
      service.remove(projectId, workloadId, 'docs', 'folder'),
    ).rejects.toThrow('Folder not found');
    await expect(
      service.remove(projectId, workloadId, 'a.txt', 'file'),
    ).rejects.toThrow('File not found');
  });
});

describe('helpers', () => {
  it('sorts folders first, then names in natural order', () => {
    const entry = (name: string, kind: 'file' | 'folder') => ({
      name,
      path: name,
      kind,
      size: null,
      content_type: null,
      modified_at: null,
    });

    expect(
      sortEntries([
        entry('b10', 'file'),
        entry('z', 'folder'),
        entry('b9', 'file'),
        entry('A', 'folder'),
      ]).map(({ name }) => name),
    ).toEqual(['A', 'z', 'b9', 'b10']);
  });

  it('quotes a file name for download, with a UTF-8 fallback', () => {
    expect(contentDisposition('my "résumé".pdf')).toBe(
      `attachment; filename="my _r_sum__.pdf"; filename*=UTF-8''my%20%22r%C3%A9sum%C3%A9%22.pdf`,
    );
  });
});
