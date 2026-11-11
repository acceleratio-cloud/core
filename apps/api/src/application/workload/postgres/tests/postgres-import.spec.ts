import { PassThrough, Readable } from 'node:stream';
import {
  FOREIGN_ROLE_HINT,
  importCommand,
  importFailure,
  importInput,
  isCustomDump,
  peek,
} from '../postgres-overview.service';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const collect = async (stream: Readable) => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }

  return Buffer.concat(chunks).toString();
};

describe('postgres import', () => {
  it('peeks at the start and leaves the stream whole', async () => {
    const stream = new PassThrough();

    stream.write('PG');
    setTimeout(() => stream.end('DMP rest'), 5);

    const head = await peek(stream, 5);

    expect(isCustomDump(head)).toBe(true);
    expect(await collect(stream)).toBe('PGDMP rest');
  });

  it('handles a body shorter than the peek', async () => {
    const stream = Readable.from([Buffer.from('se')]);
    const head = await peek(stream, 5);

    expect(isCustomDump(head)).toBe(false);
    expect(await collect(stream)).toBe('se');
  });

  it('connects as app with the password from stdin, never in argv', () => {
    for (const format of ['custom', 'sql'] as const) {
      const command = importCommand(format);

      expect(command.slice(0, 2)).toEqual(['sh', '-c']);
      expect(command).toEqual(
        expect.arrayContaining(['-h', '127.0.0.1', '-U', 'app']),
      );
      expect(command.join(' ')).not.toContain('role');
    }

    expect(importCommand('custom')).toEqual(
      expect.arrayContaining(['--single-transaction', '--exit-on-error']),
    );
  });

  it('commits a SQL script only after the whole upload arrived', async () => {
    const body = new PassThrough();
    const input = importInput(body, 'sql', 'pw');

    body.end('insert into t values (1);');

    expect(await collect(input.stream)).toBe(
      'pw\nBEGIN;\ninsert into t values (1);\n;\nCOMMIT;\n',
    );
    expect(input.interrupted()).toBe(false);
  });

  it('ends stdin without a COMMIT when the upload is cut off', async () => {
    const body = new PassThrough();
    const input = importInput(body, 'sql', 'pw');

    body.write('insert into t values (1);');
    body.destroy();

    const text = await collect(input.stream);

    expect(text).not.toContain('COMMIT');
    expect(input.interrupted()).toBe(true);
  });

  it('tells how to fix a dump that sets other roles as owners', () => {
    expect(importFailure('ERROR:  role "myuser" does not exist')).toContain(
      FOREIGN_ROLE_HINT,
    );
    expect(importFailure('ERROR:  division by zero')).not.toContain(
      FOREIGN_ROLE_HINT,
    );
  });
});
