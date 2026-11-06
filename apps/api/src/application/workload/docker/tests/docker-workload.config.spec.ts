import { BadRequestException } from '@nestjs/common';
import type { WorkloadConfig } from '@acceleratio/shared';
import {
  ENV_MAX_ITEMS,
  newDockerConfig,
  normalizeDockerConfig,
} from '../docker-workload.config';

const normalize = (config: Record<string, unknown>) =>
  normalizeDockerConfig(config as unknown as WorkloadConfig);

describe('normalizeDockerConfig', () => {
  it('keeps an image-only config as it is', () => {
    expect(normalize({ docker_image: ' nginx:1.25 ' })).toEqual({
      docker_image: 'nginx:1.25',
    });
  });

  it('drops unknown keys such as a legacy port', () => {
    expect(normalize({ docker_image: 'nginx', port: 80 })).toEqual({
      docker_image: 'nginx',
    });
  });

  it('requires an image', () => {
    expect(() => normalize({ docker_image: '  ' })).toThrow(
      BadRequestException,
    );
    expect(() => normalize({})).toThrow('docker_image is required');
  });

  it('keeps every optional setting', () => {
    expect(
      normalize({
        docker_image: 'nginx',
        cpu_max: 0.5,
        ram_max: 512,
        entrypoint: ['sh', '-c'],
        command: ['echo hi', ''],
      }),
    ).toEqual({
      docker_image: 'nginx',
      cpu_max: 0.5,
      ram_max: 512,
      entrypoint: ['sh', '-c'],
      command: ['echo hi', ''],
    });
  });

  it('rounds cpu_max to millicores', () => {
    expect(normalize({ docker_image: 'nginx', cpu_max: 0.12345 })).toEqual({
      docker_image: 'nginx',
      cpu_max: 0.123,
    });
  });

  it('omits cleared entrypoint and command', () => {
    expect(
      normalize({ docker_image: 'nginx', entrypoint: [], command: null }),
    ).toEqual({ docker_image: 'nginx' });
  });

  it('keeps a null limit, which means no limit', () => {
    expect(
      normalize({ docker_image: 'nginx', cpu_max: null, ram_max: null }),
    ).toEqual({ docker_image: 'nginx', cpu_max: null, ram_max: null });
  });

  it('keeps a replica count and drops the default of one', () => {
    expect(normalize({ docker_image: 'nginx', replicas: 3 })).toEqual({
      docker_image: 'nginx',
      replicas: 3,
    });
    expect(normalize({ docker_image: 'nginx', replicas: 1 })).toEqual({
      docker_image: 'nginx',
    });
    expect(normalize({ docker_image: 'nginx', replicas: null })).toEqual({
      docker_image: 'nginx',
    });
  });

  it.each([
    ['replicas', 0],
    ['replicas', 11],
    ['replicas', 2.5],
    ['replicas', '2'],
    ['cpu_max', 0],
    ['cpu_max', 65],
    ['cpu_max', '1'],
    ['cpu_max', Number.NaN],
    ['ram_max', 8],
    ['ram_max', 512.5],
    ['ram_max', 300000],
    ['ram_max', '512'],
    ['entrypoint', 'sh -c'],
    ['entrypoint', ['sh', 1]],
    ['command', Array.from({ length: 65 }, () => 'x')],
    ['command', ['x'.repeat(4097)]],
  ])('rejects %s = %p', (field, value) => {
    expect(() => normalize({ docker_image: 'nginx', [field]: value })).toThrow(
      BadRequestException,
    );
  });
});

describe('newDockerConfig', () => {
  it('starts a new service without limits', () => {
    expect(newDockerConfig({ docker_image: 'nginx' })).toEqual({
      docker_image: 'nginx',
      cpu_max: null,
      ram_max: null,
    });
  });

  it('keeps limits the request sets', () => {
    expect(
      newDockerConfig({
        docker_image: 'nginx',
        cpu_max: 0.5,
      }),
    ).toEqual({ docker_image: 'nginx', cpu_max: 0.5, ram_max: null });
  });
});

describe('normalizeDockerConfig env', () => {
  it('keeps variables in order with verbatim values', () => {
    const env = [
      { key: 'ZETA', value: ' spaced ' },
      { key: '_alpha1', value: '' },
      { key: 'URL', value: 'postgres://u:p@h/db?x=1#y' },
    ];

    expect(normalize({ docker_image: 'nginx', env }).env).toEqual(env);
  });

  it('omits an empty list', () => {
    expect(normalize({ docker_image: 'nginx', env: [] })).toEqual({
      docker_image: 'nginx',
    });
  });

  it('drops unknown keys on a variable', () => {
    expect(
      normalize({
        docker_image: 'nginx',
        env: [{ key: 'A', value: '1', secret: true }],
      }).env,
    ).toEqual([{ key: 'A', value: '1' }]);
  });

  it.each([['1BAD'], ['WITH-DASH'], ['has space'], ['']])(
    'rejects the variable name %p',
    (key) => {
      expect(() =>
        normalize({ docker_image: 'nginx', env: [{ key, value: 'x' }] }),
      ).toThrow(BadRequestException);
    },
  );

  it('rejects duplicate names', () => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        env: [
          { key: 'A', value: '1' },
          { key: 'A', value: '2' },
        ],
      }),
    ).toThrow('Duplicate env variable A');
  });

  it('rejects non-string values and non-list env', () => {
    expect(() =>
      normalize({ docker_image: 'nginx', env: [{ key: 'A', value: 1 }] }),
    ).toThrow(BadRequestException);
    expect(() => normalize({ docker_image: 'nginx', env: { A: '1' } })).toThrow(
      BadRequestException,
    );
  });

  it('rejects too many variables', () => {
    const env = Array.from({ length: ENV_MAX_ITEMS + 1 }, (_, index) => ({
      key: `K${index}`,
      value: '',
    }));

    expect(() => normalize({ docker_image: 'nginx', env })).toThrow(
      BadRequestException,
    );
  });

  it('rejects variables larger than the Secret budget', () => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        env: [{ key: 'BIG', value: 'x'.repeat(512 * 1024) }],
      }),
    ).toThrow(BadRequestException);
  });

  it('passes env through for a new service', () => {
    expect(
      newDockerConfig({
        docker_image: 'nginx',
        env: [{ key: 'A', value: '1' }],
      }).env,
    ).toEqual([{ key: 'A', value: '1' }]);
  });
});

describe('normalizeDockerConfig volumes', () => {
  const volume = { mount_path: '/data', size_gb: 10, storage_class_id: null };

  it('keeps volumes in order and trims trailing slashes', () => {
    expect(
      normalize({
        docker_image: 'nginx',
        volumes: [
          { ...volume, mount_path: ' /data/ ' },
          { mount_path: '/cache', size_gb: 1 },
        ],
      }).volumes,
    ).toEqual([
      volume,
      { mount_path: '/cache', size_gb: 1, storage_class_id: null },
    ]);
  });

  it('omits an empty list', () => {
    expect(normalize({ docker_image: 'nginx', volumes: [] })).toEqual({
      docker_image: 'nginx',
    });
  });

  it.each([
    ['relative', 'data'],
    ['root', '/'],
    ['dot segment', '/data/../etc'],
    ['empty segment', '/data//x'],
    ['colon', '/data:x'],
  ])('rejects a %s mount path', (_, mountPath) => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        volumes: [{ ...volume, mount_path: mountPath }],
      }),
    ).toThrow(BadRequestException);
  });

  it.each([0, 101, 1.5, '10'])('rejects a size of %p', (size) => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        volumes: [{ ...volume, size_gb: size }],
      }),
    ).toThrow('between 1 and 100');
  });

  it('rejects two volumes at one path', () => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        volumes: [volume, { ...volume, mount_path: '/data/' }],
      }),
    ).toThrow('/data');
  });

  it('rejects a storage profile that is not an id', () => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        volumes: [{ ...volume, storage_class_id: 'fast' }],
      }),
    ).toThrow('storage profile');
  });

  it('rejects more than ten volumes', () => {
    expect(() =>
      normalize({
        docker_image: 'nginx',
        volumes: Array.from({ length: 11 }, (_, index) => ({
          ...volume,
          mount_path: `/v${index}`,
        })),
      }),
    ).toThrow('at most 10');
  });
});
