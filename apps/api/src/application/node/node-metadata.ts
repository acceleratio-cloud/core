import { BadRequestException } from '@nestjs/common';
import type {
  ClusterNodeTaint,
  UpdateNodeLabelsPayload,
  UpdateNodeTaintsPayload,
} from '@acceleratio/shared';

const TAINT_EFFECTS = ['NoSchedule', 'PreferNoSchedule', 'NoExecute'];
const NAME_PART = /^[A-Za-z0-9]([-A-Za-z0-9_.]*[A-Za-z0-9])?$/;
const PREFIX =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const MAX_ENTRIES = 64;

const RESERVED_PREFIXES = [
  'kubernetes.io/',
  'k8s.io/',
  'node-role.kubernetes.io/',
  'node.kubernetes.io/',
  'node.cilium.io/',
  'beta.kubernetes.io/',
  'topology.kubernetes.io/',
  'k3s.io/',
];

/** Keys Kubernetes, k3s or Cilium own; the console never edits or removes them. */
export const isReservedKey = (key: string): boolean =>
  RESERVED_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
  key.endsWith('.kubernetes.io/') ||
  /(^|\.)(kubernetes|k8s)\.io\//.test(key);

const validateKey = (key: unknown, allowReserved = false): string => {
  if (typeof key !== 'string' || key.length === 0 || key.length > 317) {
    throw new BadRequestException('Key is invalid');
  }

  const [prefix, name, extra] = key.includes('/')
    ? key.split('/')
    : [undefined, key, undefined];

  if (
    extra !== undefined ||
    !name ||
    name.length > 63 ||
    !NAME_PART.test(name) ||
    (prefix !== undefined && (prefix.length > 253 || !PREFIX.test(prefix)))
  ) {
    throw new BadRequestException(`Key "${key}" is invalid`);
  }

  if (!allowReserved && isReservedKey(key)) {
    throw new BadRequestException(`Key "${key}" is managed by the cluster`);
  }

  return key;
};

const validateValue = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 63 ||
    (value.length > 0 && !NAME_PART.test(value))
  ) {
    throw new BadRequestException('Value is invalid');
  }

  return value;
};

export const normalizeLabels = (
  payload: UpdateNodeLabelsPayload | undefined,
): Record<string, string> => {
  const labels = (payload as { labels?: unknown } | undefined)?.labels;

  if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) {
    throw new BadRequestException('Labels must be an object');
  }

  const entries = Object.entries(labels);

  if (entries.length > MAX_ENTRIES) {
    throw new BadRequestException('Too many labels');
  }

  return Object.fromEntries(
    entries.map(([key, value]) => [validateKey(key), validateValue(value)]),
  );
};

export const normalizeTaints = (
  payload: UpdateNodeTaintsPayload | undefined,
): ClusterNodeTaint[] => {
  const taints = (payload as { taints?: unknown } | undefined)?.taints;

  if (!Array.isArray(taints) || taints.length > MAX_ENTRIES) {
    throw new BadRequestException('Taints must be a list');
  }

  const seen = new Set<string>();

  return taints.map((item: unknown) => {
    const taint = (item ?? {}) as Record<string, unknown>;
    const key = validateKey(taint.key);
    const effect = taint.effect;

    if (typeof effect !== 'string' || !TAINT_EFFECTS.includes(effect)) {
      throw new BadRequestException('Taint effect is invalid');
    }

    const value =
      taint.value === undefined || taint.value === null || taint.value === ''
        ? null
        : validateValue(taint.value);
    const id = `${key}:${effect}`;

    if (seen.has(id)) {
      throw new BadRequestException(`Taint "${key}" is duplicated`);
    }

    seen.add(id);

    return { key, value, effect: effect as ClusterNodeTaint['effect'] };
  });
};

/**
 * A service's `node_selector`. Unlike editing node labels, selecting on a
 * cluster-owned label (`kubernetes.io/hostname`, `node-role...`) is allowed.
 * An empty selector is omitted.
 */
export const normalizeNodeSelector = (
  value: unknown,
): Record<string, string> | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('node_selector must be an object');
  }

  const entries = Object.entries(value);

  if (entries.length > MAX_ENTRIES) {
    throw new BadRequestException('node_selector has too many entries');
  }

  return entries.length === 0
    ? undefined
    : Object.fromEntries(
        entries.map(([key, label]) => [
          validateKey(key, true),
          validateValue(label),
        ]),
      );
};
