import type {
  StorageBenchmarkTest,
  StorageBenchmarkTestName,
} from '@acceleratio/shared';

export const TEST_ORDER: { name: StorageBenchmarkTestName; label: string }[] = [
  { name: 'sequential-write', label: 'Sequential write' },
  { name: 'sequential-read', label: 'Sequential read' },
  { name: 'random-write', label: 'Random 4 KiB write' },
  { name: 'random-read', label: 'Random 4 KiB read' },
];

const STEP_LABELS: Record<string, string> = {
  install: 'Installing fio',
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

const MEANING: Record<
  'random-read' | 'random-write' | 'sequential',
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
