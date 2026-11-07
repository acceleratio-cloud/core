import { PassThrough } from 'node:stream';
import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  parseJsonLines,
  VictoriaLogsClient,
  VictoriaLogsUnavailableError,
} from '../victorialogs.client';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const respond = (statusCode: number, body: string) => {
  const response = Object.assign(new PassThrough(), { statusCode });

  response.end(body);

  return response;
};

/** Argument `index` of the first call. */
const argOf = (mock: jest.Mock, index: number): unknown =>
  (mock.mock.calls[0] as unknown[])[index];

const build = (proxyServiceRequest: jest.Mock) =>
  new VictoriaLogsClient({
    proxyServiceRequest,
  } as unknown as KubernetesService);

describe('parseJsonLines', () => {
  it('skips blank lines', () => {
    expect(parseJsonLines('{"a":"1"}\n\n{"a":"2"}\n')).toEqual([
      { a: '1' },
      { a: '2' },
    ]);
  });
});

describe('VictoriaLogsClient', () => {
  const original = process.env.VICTORIALOGS_ADDRESS;

  afterEach(() => {
    process.env.VICTORIALOGS_ADDRESS = original;
  });

  it('queries the configured Service through the proxy', async () => {
    process.env.VICTORIALOGS_ADDRESS = 'logs.observability:9000';
    const proxy = jest.fn().mockResolvedValue(respond(200, '{"_msg":"hi"}\n'));

    await expect(build(proxy).query('*')).resolves.toEqual([{ _msg: 'hi' }]);
    expect(proxy).toHaveBeenCalledWith(
      { service: 'logs', namespace: 'observability', port: '9000' },
      expect.objectContaining({
        path: '/select/logsql/query',
        query: { query: '*' },
      }),
    );
  });

  it('falls back to the bundled release', async () => {
    delete process.env.VICTORIALOGS_ADDRESS;
    const proxy = jest.fn().mockResolvedValue(respond(200, ''));

    await build(proxy).query('*');

    expect(argOf(proxy, 0)).toEqual({
      service: 'victoria-logs',
      namespace: 'victoria-logs',
      port: '9428',
    });
  });

  it('reads hits series', async () => {
    const proxy = jest
      .fn()
      .mockResolvedValue(
        respond(
          200,
          '{"hits":[{"fields":{"level":"error"},"timestamps":[],"values":[],"total":0}]}',
        ),
      );

    await expect(build(proxy).hits('*', 0, 60, 10, 'level')).resolves.toEqual([
      { fields: { level: 'error' }, timestamps: [], values: [], total: 0 },
    ]);
    expect(argOf(proxy, 1)).toMatchObject({
      path: '/select/logsql/hits',
      query: { start: '0', end: '60', step: '10s', field: 'level' },
    });
  });

  it.each([
    ['an HTTP error', jest.fn().mockResolvedValue(respond(400, 'bad query'))],
    [
      'a refused connection',
      jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    ],
  ])('is unavailable on %s', async (_name, proxy) => {
    await expect(build(proxy).query('*')).rejects.toThrow(
      VictoriaLogsUnavailableError,
    );
  });

  it('opens the tail with a start offset and hands over the response', async () => {
    const response = Object.assign(new PassThrough(), { statusCode: 200 });
    const proxy = jest.fn().mockResolvedValue(response);

    await expect(build(proxy).tail('*', 12.2)).resolves.toBe(response);
    expect(argOf(proxy, 1)).toMatchObject({
      path: '/select/logsql/tail',
      query: { query: '*', start_offset: '13s' },
    });
  });

  it('rejects a tail that does not open', async () => {
    const proxy = jest.fn().mockResolvedValue(respond(502, 'no upstream'));

    await expect(build(proxy).tail('*', 0)).rejects.toThrow(
      'VictoriaLogs tail failed with HTTP 502',
    );
  });
});
