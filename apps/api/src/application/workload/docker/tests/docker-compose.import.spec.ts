import { BadRequestException } from '@nestjs/common';
import { parseShellArgs } from '@/common/shell-args';
import {
  BUILD_ONLY_REASON,
  DISABLED_REASON,
  IMPORTED_VOLUME_GIB,
  planComposeImport,
} from '../docker-compose.import';

/** The plan of a file with one service, `s`, described by `body`. */
const single = (body: string) =>
  planComposeImport({
    content: `services:\n  s:\n    image: busybox:1\n${body
      .trim()
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n')}\n`,
  });

const COMPOSE = `
x-common: &common
  restart: unless-stopped

services:
  web:
    <<: *common
    image: nginx:1.27
    command: nginx -g "daemon off;"
    ports:
      - "127.0.0.1:8080:80/tcp"
      - "8443:443"
    environment:
      MODE: production
      WORKERS: 4
      FROM_HOST:
    depends_on: [cache]
  cache:
    image: redis:7
    entrypoint: ["redis-server", "--save", 60]
    environment:
      - REDIS_ARGS=--appendonly yes
      - FROM_HOST
    volumes:
      - cache-data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf:ro
      - /scratch
    deploy:
      replicas: 1
      resources:
        limits:
          cpus: "0.5"
  api:
    build: .
  broken:
    image: busybox:1
    environment:
      1BAD: value

volumes:
  cache-data:
`;

describe('planComposeImport', () => {
  const plan = planComposeImport({ content: COMPOSE });

  it('maps image, command, env and the first published port', () => {
    expect(plan.services[0]).toEqual({
      name: 'web',
      config: {
        docker_image: 'nginx:1.27',
        command: ['nginx', '-g', 'daemon off;'],
        env: [
          { key: 'MODE', value: 'production' },
          { key: 'WORKERS', value: '4' },
        ],
      },
      public_port: 80,
      ignored: [
        'restart',
        'depends_on',
        'environment.FROM_HOST',
        'ports 443/tcp',
      ],
    });
  });

  it('keeps named and anonymous volumes and skips bind mounts', () => {
    expect(plan.services[1]).toEqual({
      name: 'cache',
      config: {
        docker_image: 'redis:7',
        entrypoint: ['redis-server', '--save', '60'],
        env: [{ key: 'REDIS_ARGS', value: '--appendonly yes' }],
        volumes: [
          {
            mount_path: '/data',
            size_gb: IMPORTED_VOLUME_GIB,
            storage_class_id: null,
          },
          {
            mount_path: '/scratch',
            size_gb: IMPORTED_VOLUME_GIB,
            storage_class_id: null,
          },
        ],
      },
      public_port: null,
      ignored: [
        'deploy.resources',
        'environment.FROM_HOST',
        'volumes ./redis.conf',
      ],
    });
  });

  it('skips build-only and invalid services with the reason', () => {
    expect(plan.services).toHaveLength(2);
    expect(plan.skipped).toEqual([
      { name: 'api', reason: BUILD_ONLY_REASON },
      {
        name: 'broken',
        reason: expect.stringContaining(
          'Invalid env variable name "1BAD"',
        ) as string,
      },
    ]);
  });

  it('keeps values as the file writes them, not as numbers or dates', () => {
    const { services } = single(`
environment:
  VERSION: 1.10
  UMASK: 0755
  ID: 12345678901234567890
  RELEASED: 2024-01-01
  DEBUG: true
  UNSET: ~
command: [sleep, 1e3]
deploy:
  replicas: 2
`);

    expect(services[0].config).toMatchObject({
      env: [
        { key: 'VERSION', value: '1.10' },
        { key: 'UMASK', value: '0755' },
        { key: 'ID', value: '12345678901234567890' },
        { key: 'RELEASED', value: '2024-01-01' },
        { key: 'DEBUG', value: 'true' },
      ],
      command: ['sleep', '1e3'],
      replicas: 2,
    });
    expect(services[0].ignored).toEqual(['environment.UNSET']);
  });

  it('refuses nested values instead of expanding aliases into text', () => {
    // Nine levels of ten aliases: a billion items if flattened.
    const levels = ['l0: &l0 [x, x, x, x, x, x, x, x, x, x]'];
    for (let level = 1; level < 9; level += 1) {
      levels.push(
        `l${level}: &l${level} [${Array(10)
          .fill(`*l${level - 1}`)
          .join(', ')}]`,
      );
    }
    const content = `${levels.join('\n')}
services:
  env:
    image: busybox:1
    environment: [*l8]
  volume:
    image: busybox:1
    volumes: [*l8]
  port:
    image: busybox:1
    ports: [*l8]
`;
    const started = Date.now();

    const { skipped } = planComposeImport({ content });

    expect(Date.now() - started).toBeLessThan(1000);
    expect(skipped).toEqual([
      { name: 'env', reason: 'environment entries must be text' },
      { name: 'volume', reason: 'volumes entries must be text or mappings' },
      { name: 'port', reason: 'ports: an entry has no container port' },
    ]);
  });

  it.each([
    [['3000'], 3000, []],
    [['8000-8010:8000-8010'], 8000, []],
    [['[::1]:8080:80'], 80, []],
    [['{ target: 8080 }'], 8080, []],
    [['53:53/udp', '8080:80'], 80, ['ports 53/udp']],
    [['{ target: 53, protocol: udp }'], null, ['ports 53/udp']],
    [['5432:5432'], null, ['ports 5432/tcp']],
    [['6379', '3000'], 3000, ['ports 6379/tcp']],
  ])('publishes %j on %j', (ports, port, ignored) => {
    const { services } = single(
      `ports:\n${ports.map((entry) => `  - ${entry.startsWith('{') ? entry : JSON.stringify(entry)}`).join('\n')}`,
    );

    expect(services[0].public_port).toBe(port);
    expect(services[0].ignored).toEqual(ignored);
  });

  it('keeps long-syntax named volumes and lists bind and tmpfs mounts', () => {
    const { services } = single(`
volumes:
  - { type: volume, source: data, target: /data }
  - { type: bind, source: ./conf, target: /conf }
  - { type: tmpfs, target: /tmp }
`);

    expect(services[0].config.volumes).toEqual([
      {
        mount_path: '/data',
        size_gb: IMPORTED_VOLUME_GIB,
        storage_class_id: null,
      },
    ]);
    expect(services[0].ignored).toEqual(['volumes ./conf', 'volumes tmpfs']);
  });

  it('says why turned-off and build-only services are skipped', () => {
    const { skipped } = planComposeImport({
      content: `services:
  worker:
    image: app:1
    deploy: { replicas: 0 }
  api:
    image: ~
    build: .
`,
    });

    expect(skipped).toEqual([
      { name: 'worker', reason: DISABLED_REASON },
      { name: 'api', reason: BUILD_ONLY_REASON },
    ]);
  });

  it.each([
    ['', 'Paste a compose file'],
    ['services: [', 'The file is not valid YAML'],
    ['version: "3"', 'The file has no services'],
  ])('rejects %j', (content, message) => {
    expect(() => planComposeImport({ content })).toThrow(BadRequestException);
    expect(() => planComposeImport({ content })).toThrow(message);
  });
});

describe('parseShellArgs', () => {
  it.each([
    ['npm run start', ['npm', 'run', 'start']],
    [`sh -c 'echo "$HOME"'`, ['sh', '-c', 'echo "$HOME"']],
    ['a\\ b ""', ['a b', '']],
  ])('splits %j', (line, args) => {
    expect(parseShellArgs(line)).toEqual(args);
  });

  it('rejects an open quote', () => {
    expect(() => parseShellArgs('echo "hi')).toThrow('Close the double quote.');
  });
});
