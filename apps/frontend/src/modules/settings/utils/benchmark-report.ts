import type {
  StorageBenchmarkTest,
  StorageBenchmarkTestName,
} from '@acceleratio/shared';

export const TEST_ORDER: { name: StorageBenchmarkTestName; label: string }[] = [
  { name: 'sequential-write', label: 'Sequential write' },
  { name: 'sequential-read', label: 'Sequential read' },
  { name: 'random-write', label: 'Random 4 KiB write' },
  { name: 'random-read', label: 'Random 4 KiB read' },
  { name: 'random-write-latency', label: 'Single 4 KiB write latency' },
  { name: 'random-read-latency', label: 'Single 4 KiB read latency' },
];

/** Method 1 (buffered I/O, before Longhorn) ran only the first four tests. */
export const testsForMethod = (method: number) =>
  method === 1 ? TEST_ORDER.slice(0, 4) : TEST_ORDER;

const STEP_LABELS: Record<string, string> = {
  install: 'Installing fio',
  prepare: 'Writing the test file',
  provision: 'Provisioning the test volume',
  start: 'Starting the benchmark',
  results: 'Reading the results',
  unknown: 'Unknown step',
};

export const stepLabel = (step: string) =>
  STEP_LABELS[step] ??
  TEST_ORDER.find((test) => test.name === step)?.label ??
  step;

export type VerdictLevel = 'excellent' | 'good' | 'moderate' | 'slow';

export type Verdict = { level: VerdictLevel; text: string };

const LEVEL_WORDS: Record<VerdictLevel, string> = {
  excellent: 'Excellent',
  good: 'Good',
  moderate: 'Moderate',
  slow: 'Slow',
};

const level = (
  value: number,
  [excellent, good, moderate]: [number, number, number],
): VerdictLevel =>
  value >= excellent
    ? 'excellent'
    : value >= good
      ? 'good'
      : value >= moderate
        ? 'moderate'
        : 'slow';

/** Like `level`, for values where lower is better. */
const levelBelow = (
  value: number,
  [excellent, good, moderate]: [number, number, number],
): VerdictLevel =>
  value <= excellent
    ? 'excellent'
    : value <= good
      ? 'good'
      : value <= moderate
        ? 'moderate'
        : 'slow';

const MEANING: Record<
  | 'random-read'
  | 'random-write'
  | 'sequential'
  | 'read-latency'
  | 'write-latency',
  Record<VerdictLevel, string>
> = {
  'random-read': {
    excellent: 'NVMe-class small reads; fine for busy databases.',
    good: 'SSD-class small reads; fine for most databases.',
    moderate: 'Enough for light databases and app data.',
    slow: 'HDD-class small reads; avoid for databases.',
  },
  'random-write': {
    excellent: 'Fast small writes; fine for write-heavy databases.',
    good: 'Good small writes for most databases and queues.',
    moderate: 'Enough for light write loads.',
    slow: 'Slow small writes; databases will wait on disk.',
  },
  'read-latency': {
    excellent: 'Local-disk-class reads; queries rarely wait on storage.',
    good: 'Fast enough for most databases.',
    moderate: 'Noticeable on queries that read many rows from disk.',
    slow: 'Every uncached read waits; avoid for databases.',
  },
  'write-latency': {
    excellent: 'Commits barely wait on storage.',
    good: 'Fine for most databases; each commit waits about this long.',
    moderate: 'Commit-heavy apps will feel it.',
    slow: 'Every commit waits this long; avoid for databases.',
  },
  sequential: {
    excellent: 'Moves large files very quickly.',
    good: 'Good for backups, media and large files.',
    moderate: 'Fine for occasional large files.',
    slow: 'Large copies and backups will be slow.',
  },
};

/** A plain-language reading of one test's main number. */
export const testVerdict = (test: StorageBenchmarkTest): Verdict => {
  if (test.pattern === 'sequential') {
    const value = level(test.bandwidth_mbps, [500, 200, 80]);

    return {
      level: value,
      text: `${LEVEL_WORDS[value]}. ${MEANING.sequential[value]}`,
    };
  }

  // One request at a time: the latency is the result, not the IOPS.
  if (test.parameters.io_depth === 1) {
    const kind = test.direction === 'read' ? 'read-latency' : 'write-latency';
    const value =
      test.direction === 'read'
        ? levelBelow(test.latency_ms.mean, [0.2, 1, 5])
        : levelBelow(test.latency_ms.mean, [0.5, 2, 10]);

    return {
      level: value,
      text: `${LEVEL_WORDS[value]}. ${MEANING[kind][value]}`,
    };
  }

  const kind = test.direction === 'read' ? 'random-read' : 'random-write';
  const value =
    test.direction === 'read'
      ? level(test.iops, [20_000, 5_000, 1_000])
      : level(test.iops, [10_000, 2_000, 500]);

  return {
    level: value,
    text: `${LEVEL_WORDS[value]}. ${MEANING[kind][value]}`,
  };
};

/**
 * Whether latency is steady: tail latency far above the median means some
 * requests wait much longer than usual.
 */
export const latencyNote = (test: StorageBenchmarkTest) => {
  const { p50, p99 } = test.latency_ms;

  if (p99 <= 0) {
    return null;
  }

  const ratio = p50 > 0 ? p99 / p50 : Infinity;

  if (p99 >= 50 || ratio >= 20) {
    return {
      steady: false,
      text: `Latency spikes: 1 in 100 requests took ${formatLatency(p99)} or longer${
        Number.isFinite(ratio) ? `, ${Math.round(ratio)}× the median` : ''
      }.`,
    };
  }

  return {
    steady: true,
    text: `Steady latency: 99% of requests finished within ${formatLatency(p99)}.`,
  };
};

export const formatLatency = (ms: number) =>
  ms >= 1000
    ? `${(ms / 1000).toFixed(1)} s`
    : ms >= 10
      ? `${Math.round(ms)} ms`
      : ms >= 1
        ? `${ms.toFixed(1)} ms`
        : `${Math.round(ms * 1000)} µs`;

export const formatMegabytes = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`;

export const formatNumber = (value: number) =>
  new Intl.NumberFormat('en').format(Math.round(value));
