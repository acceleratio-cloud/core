import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type {
  FilerRequest,
  SeaweedfsFilerClient,
} from '@/vendor/seaweedfs/seaweedfs-filer.client';
import type { S3BucketWorkloadService } from '../s3-bucket.service';
import {
  contentDisposition,
  S3BucketObjectsService,
  sortEntries,
} from '../s3-bucket-objects.service';

// Both pull the ESM-only Kubernetes client; every instance here is faked.
jest.mock('@/vendor/seaweedfs/seaweedfs-filer.client', () => ({
  ...jest.requireActual<object>('@/vendor/seaweedfs/seaweedfs-filer.client'),
  SeaweedfsFilerClient: class SeaweedfsFilerClient {},
}));
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));
jest.mock('../s3-bucket.service', () => ({
  S3BucketWorkloadService: class S3BucketWorkloadService {},
}));

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';
const DIR = 2 ** 31 + 0o755;

const response = (
  status: number,
  body: unknown = '',
  headers: Record<string, string> = {},
): IncomingMessage =>
  Object.assign(
    Readable.from([
      Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
    ]),
    { statusCode: status, headers },
  ) as unknown as IncomingMessage;

/** A ClientRequest stand-in that keeps what an upload writes. */
const recordingRequest = () => {
  const emitter = new EventEmitter();
  const chunks: Buffer[] = [];
  const request = Object.assign(emitter, {
    write: (chunk: Buffer) => {
      chunks.push(chunk);
      return true;
    },
    end: (chunk?: Buffer) => {
      if (chunk) {
        chunks.push(chunk);
      }
      emitter.emit('finish');
    },
    destroy: jest.fn(),
  });

  return {
    request: request as unknown as ClientRequest,
    text: () => Buffer.concat(chunks).toString('utf8'),
    finished: new Promise((resolve) => emitter.once('finish', resolve)),
  };
};

const createService = (status: 'running' | 'deploying' = 'running') => {
  const requests: FilerRequest[] = [];
  const replies: (IncomingMessage | Error)[] = [];
  const filer = {
    request: jest.fn((input: FilerRequest) => {
      requests.push(input);
      const reply = replies.shift() ?? response(200, '{}');

      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    }),
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
    filer as unknown as SeaweedfsFilerClient,
  );

  return { service, requests, replies };
};

describe('S3BucketObjectsService.list', () => {
  it('lists one folder, folders first, as keys from the bucket root', async () => {
    const { service, requests, replies } = createService();

    replies.push(
      response(200, {
        Entries: [
          {
            FullPath: '/buckets/demo-assets/docs/report 10.pdf',
            Mode: 0o644,
            Mime: 'application/pdf',
            FileSize: 2048,
            Mtime: '2026-11-04T10:00:00Z',
          },
          {
            FullPath: '/buckets/demo-assets/docs/2026',
            Mode: DIR,
            Mtime: '2026-11-04T09:00:00Z',
          },
          {
            FullPath: '/buckets/demo-assets/docs/report 9.pdf',
            Mode: 0o644,
            FileSize: 10,
          },
        ],
        ShouldDisplayLoadMore: true,
      }),
    );

    const listing = await service.list(projectId, workloadId, '/docs');

    expect(requests[0]).toMatchObject({
      method: 'GET',
      path: '/buckets/demo-assets/docs/',
      query: { limit: '1000' },
      headers: { Accept: 'application/json' },
    });
    expect(listing).toEqual({
      prefix: 'docs/',
      truncated: true,
      entries: [
        {
          name: '2026',
          path: 'docs/2026/',
          kind: 'folder',
          size: null,
          content_type: null,
          modified_at: '2026-11-04T09:00:00Z',
        },
        expect.objectContaining({
          name: 'report 9.pdf',
          kind: 'file',
          size: 10,
        }),
        expect.objectContaining({
          name: 'report 10.pdf',
          path: 'docs/report 10.pdf',
          content_type: 'application/pdf',
          size: 2048,
        }),
      ],
    });
  });

  it('encodes each segment of the path', async () => {
    const { service, requests, replies } = createService();

    replies.push(response(200, { Entries: null }));

    await expect(
      service.list(projectId, workloadId, 'my résumé/a#b'),
    ).resolves.toMatchObject({ entries: [], truncated: false });
    expect(requests[0].path).toBe(
      '/buckets/demo-assets/my%20r%C3%A9sum%C3%A9/a%23b/',
    );
  });

  it('reports a missing folder as 404', async () => {
    const { service, replies } = createService();

    replies.push(response(404));

    await expect(service.list(projectId, workloadId, 'gone')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('turns an unreachable filer into 502', async () => {
    const { service, replies } = createService();

    replies.push(new Error('ECONNREFUSED'));

    await expect(service.list(projectId, workloadId, '')).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('refuses a bucket that is not ready', async () => {
    const { service, requests } = createService('deploying');

    await expect(service.list(projectId, workloadId, '')).rejects.toThrow(
      'The bucket is still being created',
    );
    expect(requests).toHaveLength(0);
  });
});

describe('S3BucketObjectsService.createFolder', () => {
  it('makes the folder when the name is free', async () => {
    const { service, requests, replies } = createService();

    replies.push(response(404), response(201, '{"name":"new"}'));

    await expect(
      service.createFolder(projectId, workloadId, 'docs/new'),
    ).resolves.toMatchObject({
      name: 'new',
      path: 'docs/new/',
      kind: 'folder',
    });
    expect(requests[0]).toMatchObject({
      path: '/buckets/demo-assets/docs/new',
      query: { metadata: 'true' },
    });
    expect(requests[1]).toMatchObject({
      method: 'POST',
      path: '/buckets/demo-assets/docs/new/',
      query: { op: 'mkdir' },
    });
  });

  it('refuses a name a file or folder already has', async () => {
    const { service, requests, replies } = createService();

    replies.push(
      response(200, { FullPath: '/buckets/demo-assets/docs', Mode: DIR }),
    );

    await expect(
      service.createFolder(projectId, workloadId, 'docs'),
    ).rejects.toThrow(ConflictException);
    expect(requests).toHaveLength(1);
  });

  it('validates the path before calling the filer', async () => {
    const { service, requests } = createService();

    await expect(
      service.createFolder(projectId, workloadId, 'a/../b'),
    ).rejects.toThrow(BadRequestException);
    expect(requests).toHaveLength(0);
  });
});

describe('S3BucketObjectsService.upload', () => {
  it('streams the body to the filer as one multipart part', async () => {
    const { service, requests, replies } = createService();
    const recording = recordingRequest();

    replies.push(response(201, '{"name":"a.txt","size":5}'));

    const uploaded = service.upload(
      projectId,
      workloadId,
      'docs/a "b".txt',
      Readable.from([Buffer.from('he'), Buffer.from('llo')]),
      'text/plain',
    );

    // The service resolves after the filer answers; drive the body first.
    await new Promise((resolve) => setImmediate(resolve));
    const body = requests[0].body as (request: ClientRequest) => void;

    body(recording.request);
    await recording.finished;

    await expect(uploaded).resolves.toMatchObject({
      path: 'docs/a "b".txt',
      size: 5,
      content_type: 'text/plain',
    });

    const boundary = /boundary=(.+)$/.exec(
      requests[0].headers!['Content-Type'],
    )![1];

    expect(requests[0].path).toBe('/buckets/demo-assets/docs/a%20%22b%22.txt');
    expect(recording.text()).toBe(
      `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="file"; filename="a _b_.txt"\r\n' +
        'Content-Type: text/plain\r\n\r\n' +
        'hello' +
        `\r\n--${boundary}--\r\n`,
    );
  });

  it('refuses a folder key', async () => {
    const { service } = createService();

    await expect(
      service.upload(
        projectId,
        workloadId,
        'docs/',
        Readable.from([]),
        undefined,
      ),
    ).rejects.toThrow('File path cannot end with /');
  });
});

describe('S3BucketObjectsService.download', () => {
  it('streams the file with its type and length', async () => {
    const { service, replies } = createService();
    const body = response(200, 'hello', {
      'content-type': 'text/plain',
      'content-length': '5',
    });

    replies.push(
      response(200, { FullPath: '/buckets/demo-assets/a.txt', Mode: 0o644 }),
      body,
    );

    await expect(
      service.download(projectId, workloadId, 'a.txt'),
    ).resolves.toEqual({
      name: 'a.txt',
      contentType: 'text/plain',
      contentLength: 5,
      body,
    });
  });

  it('refuses a folder and a missing file', async () => {
    const { service, replies } = createService();

    replies.push(
      response(200, { FullPath: '/buckets/demo-assets/docs', Mode: DIR }),
    );
    await expect(
      service.download(projectId, workloadId, 'docs'),
    ).rejects.toThrow('This path is a folder');

    replies.push(response(404));
    await expect(
      service.download(projectId, workloadId, 'nope'),
    ).rejects.toThrow('File not found');
  });
});

describe('S3BucketObjectsService.remove', () => {
  it('deletes a folder with its contents', async () => {
    const { service, requests, replies } = createService();

    replies.push(response(204));

    await service.remove(projectId, workloadId, 'docs', 'folder');

    expect(requests[0]).toMatchObject({
      method: 'DELETE',
      path: '/buckets/demo-assets/docs/',
      query: { recursive: 'true' },
    });
  });

  it('deletes one file', async () => {
    const { service, requests, replies } = createService();

    replies.push(response(204));

    await service.remove(projectId, workloadId, 'docs/a.txt', 'file');

    expect(requests[0]).toMatchObject({
      path: '/buckets/demo-assets/docs/a.txt',
      query: {},
    });
  });

  it('maps a filer error to 502', async () => {
    const { service, replies } = createService();

    replies.push(response(500, 'boom'));

    await expect(
      service.remove(projectId, workloadId, 'docs/a.txt', 'file'),
    ).rejects.toThrow('SeaweedFS could not delete the file');
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
