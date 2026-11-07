import type {
  DockerWorkloadConfig,
  DockerWorkloadVolume,
  WorkloadChangeImpact,
  WorkloadDiffSection,
} from '@acceleratio/shared';
import {
  changesOf,
  compareField,
  compareSecret,
  unionKeys,
} from '@/application/workload/workload-version.diff';
import {
  DEFAULT_CPU_MAX,
  DEFAULT_RAM_MAX,
  DEFAULT_REPLICAS,
} from './docker-workload.config';

/**
 * The fields of two Docker configs that differ, by section. A null base is a
 * service that was never deployed: everything is added and nothing restarts.
 *
 * Impacts follow what the deploy does to the Deployment:
 * - the image, command, limits, placement, variables and volume mounts are in
 *   the pod template, so changing them rolls the pods;
 * - replicas only scale, so they have no impact;
 * - a volume the target drops has its claim deleted after the rollout, so its
 *   data is lost.
 */
export const diffDockerConfigs = (
  base: DockerWorkloadConfig | null,
  target: DockerWorkloadConfig | null,
): WorkloadDiffSection[] => {
  const running = base !== null;
  const restart: WorkloadChangeImpact | null = running ? 'restart' : null;
  const dataLoss: WorkloadChangeImpact | null = running ? 'data_loss' : null;

  return [
    {
      key: 'image',
      label: 'Image',
      changes: changesOf([
        compareField({
          path: 'docker_image',
          label: 'Image',
          before: base?.docker_image ?? null,
          after: target?.docker_image ?? null,
          impact: restart,
        }),
      ]),
    },
    {
      key: 'command',
      label: 'Command',
      changes: changesOf([
        compareField({
          path: 'entrypoint',
          label: 'Entrypoint',
          before: base && formatArgs(base.entrypoint),
          after: target && formatArgs(target.entrypoint),
          impact: restart,
        }),
        compareField({
          path: 'command',
          label: 'Command',
          before: base && formatArgs(base.command),
          after: target && formatArgs(target.command),
          impact: restart,
        }),
      ]),
    },
    {
      key: 'resources',
      label: 'Resources',
      changes: changesOf([
        compareField({
          path: 'cpu_max',
          label: 'CPU limit',
          before: base && formatCpu(base.cpu_max),
          after: target && formatCpu(target.cpu_max),
          impact: restart,
        }),
        compareField({
          path: 'ram_max',
          label: 'Memory limit',
          before: base && formatMemory(base.ram_max),
          after: target && formatMemory(target.ram_max),
          impact: restart,
        }),
        compareField({
          path: 'replicas',
          label: 'Replicas',
          before: base && formatReplicas(base.replicas),
          after: target && formatReplicas(target.replicas),
        }),
      ]),
    },
    {
      key: 'placement',
      label: 'Placement',
      changes: diffNodeSelector(
        base?.node_selector ?? {},
        target?.node_selector ?? {},
        restart,
      ),
    },
    {
      key: 'environment',
      label: 'Environment',
      changes: diffEnv(base, target, restart),
    },
    {
      key: 'volumes',
      label: 'Volumes',
      changes: diffVolumes(
        base?.volumes ?? [],
        target?.volumes ?? [],
        restart,
        dataLoss,
      ),
    },
  ];
};

/** `["npm","start"]`, or the image's own when the field is unset. */
export const formatArgs = (args: string[] | undefined): string =>
  args?.length ? JSON.stringify(args) : 'Image default';

/** Absent means the 1 vCPU default of configs stored before limits were optional. */
export const formatCpu = (value: number | null | undefined): string => {
  if (value === null) {
    return 'No limit';
  }

  return `${value ?? DEFAULT_CPU_MAX} vCPU`;
};

export const formatMemory = (value: number | null | undefined): string => {
  if (value === null) {
    return 'No limit';
  }

  const mib = value ?? DEFAULT_RAM_MAX;

  return mib >= 1024 && mib % 1024 === 0 ? `${mib / 1024} GiB` : `${mib} MiB`;
};

export const formatReplicas = (value: number | undefined): string => {
  const count = value ?? DEFAULT_REPLICAS;

  return `${count} ${count === 1 ? 'replica' : 'replicas'}`;
};

const diffNodeSelector = (
  base: Record<string, string>,
  target: Record<string, string>,
  impact: WorkloadChangeImpact | null,
) =>
  changesOf(
    unionKeys(Object.keys(base).sort(), Object.keys(target).sort()).map((key) =>
      compareField({
        path: `node_selector.${key}`,
        label: key,
        before: base[key] ?? null,
        after: target[key] ?? null,
        impact,
      }),
    ),
  );

/**
 * Variables are applied through a Kubernetes Secret, so every value is
 * treated as secret: the comparison happens here and only its result leaves.
 * Duplicate keys resolve like Kubernetes `envFrom` does: the last one wins.
 */
const diffEnv = (
  base: DockerWorkloadConfig | null,
  target: DockerWorkloadConfig | null,
  impact: WorkloadChangeImpact | null,
) => {
  const before = new Map(
    (base?.env ?? []).map(({ key, value }) => [key, value]),
  );
  const after = new Map(
    (target?.env ?? []).map(({ key, value }) => [key, value]),
  );

  return changesOf(
    unionKeys([...before.keys()], [...after.keys()]).map((key) =>
      compareSecret({
        path: `env.${key}`,
        label: key,
        inBase: before.has(key),
        inTarget: after.has(key),
        same: before.get(key) === after.get(key),
        impact,
      }),
    ),
  );
};

const describeVolume = (volume: DockerWorkloadVolume): string =>
  `${volume.mount_path} · ${volume.size_gb} GiB`;

/**
 * Volumes are matched by id, so a moved mount path reads as a change of the
 * same volume rather than one removed and another added.
 */
const diffVolumes = (
  base: DockerWorkloadVolume[],
  target: DockerWorkloadVolume[],
  restart: WorkloadChangeImpact | null,
  dataLoss: WorkloadChangeImpact | null,
) => {
  const keyOf = (volume: DockerWorkloadVolume) =>
    volume.id ?? volume.mount_path;
  const before = new Map(base.map((volume) => [keyOf(volume), volume]));
  const after = new Map(target.map((volume) => [keyOf(volume), volume]));

  return changesOf(
    unionKeys([...before.keys()], [...after.keys()]).flatMap((id) => {
      const left = before.get(id);
      const right = after.get(id);

      if (!left || !right) {
        const volume = (left ?? right)!;

        return [
          compareField({
            path: `volumes.${id}`,
            label: volume.mount_path,
            before: left ? describeVolume(left) : null,
            after: right ? describeVolume(right) : null,
            impact: left ? dataLoss : restart,
          }),
        ];
      }

      return [
        compareField({
          path: `volumes.${id}.mount_path`,
          label: `Mount path of ${left.mount_path}`,
          before: left.mount_path,
          after: right.mount_path,
          impact: restart,
        }),
        compareField({
          path: `volumes.${id}.size_gb`,
          label: `Size of ${right.mount_path}`,
          before: `${left.size_gb} GiB`,
          after: `${right.size_gb} GiB`,
        }),
        compareField({
          path: `volumes.${id}.storage_class_id`,
          label: `Storage profile of ${right.mount_path}`,
          before: left.storage_class_id ?? 'Platform profile',
          after: right.storage_class_id ?? 'Platform profile',
        }),
      ];
    }),
  );
};
