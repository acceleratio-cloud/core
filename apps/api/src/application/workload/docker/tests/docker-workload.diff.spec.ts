import type { DockerWorkloadConfig } from '@acceleratio/shared';
import { buildDiff } from '@/application/workload/workload-version.diff';
import {
  diffDockerConfigs,
  formatArgs,
  formatCpu,
  formatMemory,
  formatReplicas,
} from '../docker-workload.diff';

const volumeId = '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const otherVolumeId = '8d9e0f1a-2b3c-4d4e-9f5a-6b7c8d9e0f1a';

const base: DockerWorkloadConfig = {
  docker_image: 'nginx:1.25',
  cpu_max: 0.5,
  ram_max: 512,
  env: [
    { key: 'DATABASE_URL', value: 'postgres://old-secret@db/app' },
    { key: 'LOG_LEVEL', value: 'info' },
  ],
  volumes: [
    { id: volumeId, mount_path: '/data', size_gb: 10, storage_class_id: null },
  ],
};

const sectionOf = (
  sections: ReturnType<typeof diffDockerConfigs>,
  key: string,
) => sections.find((section) => section.key === key)?.changes ?? [];

const diff = (
  left: DockerWorkloadConfig | null,
  right: DockerWorkloadConfig | null,
) =>
  buildDiff({
    workloadId: 'w',
    type: 'docker',
    base: left
      ? { kind: 'version', version_id: 'a', number: 1 }
      : { kind: 'none' },
    target: { kind: 'draft' },
    sections: diffDockerConfigs(left, right),
  });

describe('diffDockerConfigs', () => {
  it('reports nothing for equal configs', () => {
    const result = diff(base, structuredClone(base));

    expect(result.identical).toBe(true);
    expect(result.sections).toEqual([]);
    expect(result.restarts).toBe(false);
    expect(result.data_loss).toBe(false);
  });

  it('marks an image change as one that restarts the pods', () => {
    const result = diff(base, { ...base, docker_image: 'nginx:1.26' });

    expect(result.sections).toEqual([
      {
        key: 'image',
        label: 'Image',
        changes: [
          {
            path: 'docker_image',
            label: 'Image',
            kind: 'changed',
            before: 'nginx:1.25',
            after: 'nginx:1.26',
            secret: false,
            impact: 'restart',
          },
        ],
      },
    ]);
    expect(result.restarts).toBe(true);
    expect(result.data_loss).toBe(false);
  });

  it('reads absent limits as the old defaults and null as no limit', () => {
    const changes = sectionOf(
      diffDockerConfigs(
        { docker_image: 'nginx' },
        { docker_image: 'nginx', cpu_max: null, ram_max: 2048 },
      ),
      'resources',
    );

    expect(changes).toEqual([
      expect.objectContaining({
        path: 'cpu_max',
        before: '1 vCPU',
        after: 'No limit',
        kind: 'changed',
      }),
      expect.objectContaining({
        path: 'ram_max',
        before: '1 GiB',
        after: '2 GiB',
      }),
    ]);
  });

  it('treats replicas as a scale, not a restart', () => {
    const result = diff(base, { ...base, replicas: 3 });

    expect(sectionOf(result.sections, 'resources')).toEqual([
      expect.objectContaining({
        path: 'replicas',
        before: '1 replica',
        after: '3 replicas',
        impact: null,
      }),
    ]);
    expect(result.restarts).toBe(false);
  });

  it('compares the command against the image default', () => {
    const changes = sectionOf(
      diffDockerConfigs(base, { ...base, command: ['npm', 'start'] }),
      'command',
    );

    expect(changes).toEqual([
      expect.objectContaining({
        path: 'command',
        kind: 'changed',
        before: 'Image default',
        after: '["npm","start"]',
      }),
    ]);
  });

  it('diffs node labels key by key', () => {
    const changes = sectionOf(
      diffDockerConfigs(
        { ...base, node_selector: { zone: 'a', disk: 'ssd' } },
        { ...base, node_selector: { zone: 'b', gpu: 'true' } },
      ),
      'placement',
    );

    expect(changes.map(({ label, kind }) => [label, kind])).toEqual([
      ['disk', 'removed'],
      ['zone', 'changed'],
      ['gpu', 'added'],
    ]);
  });

  it('never returns variable values, only what happened to each key', () => {
    const target: DockerWorkloadConfig = {
      ...base,
      env: [
        { key: 'DATABASE_URL', value: 'postgres://new-secret@db/app' },
        { key: 'FEATURE_FLAG', value: 'on' },
      ],
    };
    const result = diff(base, target);
    const changes = sectionOf(result.sections, 'environment');

    expect(changes).toEqual([
      {
        path: 'env.DATABASE_URL',
        label: 'DATABASE_URL',
        kind: 'changed',
        before: null,
        after: null,
        secret: true,
        impact: 'restart',
      },
      expect.objectContaining({ label: 'LOG_LEVEL', kind: 'removed' }),
      expect.objectContaining({ label: 'FEATURE_FLAG', kind: 'added' }),
    ]);

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('secret@db');
    expect(serialized).not.toContain('"info"');
    expect(serialized).not.toContain('"on"');
  });

  it('does not report a variable whose value stayed the same', () => {
    const changes = sectionOf(
      diffDockerConfigs(base, {
        ...base,
        env: [...base.env!].reverse(),
      }),
      'environment',
    );

    expect(changes).toEqual([]);
  });

  it('marks a dropped volume as data loss and a new one as a restart', () => {
    const result = diff(base, {
      ...base,
      volumes: [
        {
          id: otherVolumeId,
          mount_path: '/cache',
          size_gb: 1,
          storage_class_id: null,
        },
      ],
    });

    expect(sectionOf(result.sections, 'volumes')).toEqual([
      expect.objectContaining({
        path: `volumes.${volumeId}`,
        label: '/data',
        kind: 'removed',
        before: '/data · 10 GiB',
        after: null,
        impact: 'data_loss',
      }),
      expect.objectContaining({
        path: `volumes.${otherVolumeId}`,
        kind: 'added',
        after: '/cache · 1 GiB',
        impact: 'restart',
      }),
    ]);
    expect(result.data_loss).toBe(true);
    expect(result.restarts).toBe(true);
  });

  it('matches volumes by id, so a moved mount path is one change', () => {
    const changes = sectionOf(
      diffDockerConfigs(base, {
        ...base,
        volumes: [{ ...base.volumes![0], mount_path: '/var/lib/data' }],
      }),
      'volumes',
    );

    expect(changes).toEqual([
      expect.objectContaining({
        path: `volumes.${volumeId}.mount_path`,
        kind: 'changed',
        before: '/data',
        after: '/var/lib/data',
        impact: 'restart',
      }),
    ]);
  });

  it('adds everything without impact before the first deploy', () => {
    const result = diff(null, base);

    expect(result.base).toEqual({ kind: 'none' });
    expect(result.restarts).toBe(false);
    expect(result.data_loss).toBe(false);
    expect(
      result.sections
        .flatMap((section) => section.changes)
        .every((change) => change.kind === 'added' && change.impact === null),
    ).toBe(true);
    expect(sectionOf(result.sections, 'image')[0].after).toBe('nginx:1.25');
  });

  it('keeps the section order fixed', () => {
    const result = diff(base, {
      docker_image: 'nginx:1.26',
      cpu_max: 1,
      command: ['serve'],
      replicas: 2,
      node_selector: { zone: 'a' },
      env: [],
      volumes: [],
    });

    expect(result.sections.map((section) => section.key)).toEqual([
      'image',
      'command',
      'resources',
      'placement',
      'environment',
      'volumes',
    ]);
  });
});

describe('Docker diff formatting', () => {
  it('formats values the way the console labels them', () => {
    expect(formatArgs(undefined)).toBe('Image default');
    expect(formatArgs([])).toBe('Image default');
    expect(formatCpu(undefined)).toBe('1 vCPU');
    expect(formatCpu(0.25)).toBe('0.25 vCPU');
    expect(formatMemory(null)).toBe('No limit');
    expect(formatMemory(1536)).toBe('1536 MiB');
    expect(formatMemory(4096)).toBe('4 GiB');
    expect(formatReplicas(undefined)).toBe('1 replica');
  });
});
