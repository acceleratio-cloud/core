import type {
  ClusterNodeTaint,
  ClusterNodeTaintEffect,
} from '@acceleratio/shared';

const EFFECTS: ClusterNodeTaintEffect[] = [
  'NoSchedule',
  'PreferNoSchedule',
  'NoExecute',
];

/** Keys Kubernetes and k3s own; the API keeps them and refuses edits. */
const RESERVED = /(^|\.)(kubernetes|k8s)\.io\/|^k3s\.io\/|^node\.cilium\.io\//;

export const isReservedKey = (key: string): boolean => RESERVED.test(key);

export const formatLabels = (labels: Record<string, string>): string =>
  Object.entries(labels)
    .filter(([key]) => !isReservedKey(key))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

export const formatTaints = (taints: ClusterNodeTaint[]): string =>
  taints
    .filter((taint) => !isReservedKey(taint.key))
    .map(
      (taint) =>
        `${taint.key}${taint.value ? `=${taint.value}` : ''}:${taint.effect}`,
    )
    .join('\n');

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** One `key=value` per line. A line without `=` is a label with no value. */
export const parseLabels = (text: string): Record<string, string> =>
  Object.fromEntries(
    lines(text).map((line) => {
      const index = line.indexOf('=');

      return index === -1
        ? [line, '']
        : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
  );

/** One `key=value:Effect` (or `key:Effect`) per line. */
export const parseTaints = (text: string): ClusterNodeTaint[] =>
  lines(text).map((line) => {
    const index = line.lastIndexOf(':');
    const effect = line.slice(index + 1).trim() as ClusterNodeTaintEffect;

    if (index === -1 || !EFFECTS.includes(effect)) {
      throw new Error(
        `"${line}" needs an effect: ${EFFECTS.join(', ')} (key=value:NoSchedule)`,
      );
    }

    const spec = line.slice(0, index);
    const equals = spec.indexOf('=');

    return {
      key: (equals === -1 ? spec : spec.slice(0, equals)).trim(),
      value: equals === -1 ? null : spec.slice(equals + 1).trim() || null,
      effect,
    };
  });

/** A service's node selector may use any label, including cluster-owned ones. */
export const formatSelector = (selector: Record<string, string>): string =>
  Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
