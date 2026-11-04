import { BadRequestException } from '@nestjs/common';
import type { WorkloadConfig } from '@acceleratio/shared';
import { normalizeDockerConfig } from '../docker-workload.config';

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

  it('omits cleared settings so they compare equal to unset ones', () => {
    expect(
      normalize({
        docker_image: 'nginx',
        cpu_max: null,
        ram_max: null,
        entrypoint: [],
        command: null,
      }),
    ).toEqual({ docker_image: 'nginx' });
  });

  it.each([
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
