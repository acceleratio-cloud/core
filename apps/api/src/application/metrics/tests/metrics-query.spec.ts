import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  clusterUsageQueries,
  createPodResolver,
  foldTraffic,
  instanceQueries,
  foldSignal,
  isMetricsRange,
  lastValues,
  metricsWindow,
  parseQuantity,
  postgresQueries,
  projectQueries,
  scalarValue,
  trafficQueries,
  valuesByPod,
  volumeQueries,
  type WorkloadRef,
} from '../metrics-query';

const web: WorkloadRef = { id: 'w-web', name: 'web', external_name: 'web' };
const webWorker: WorkloadRef = {
  id: 'w-worker',
  name: 'web worker',
  external_name: 'web-worker',
};

describe('isMetricsRange', () => {
  it('accepts the supported ranges only', () => {
    expect(isMetricsRange('1h')).toBe(true);
    expect(isMetricsRange('7d')).toBe(true);
    expect(isMetricsRange('2h')).toBe(false);
    expect(isMetricsRange(undefined)).toBe(false);
  });
});

describe('metricsWindow', () => {
  it('aligns the end to the step and spans the range', () => {
    const window = metricsWindow('1h', 1_000_017);

    expect(window.step).toBe(30);
    expect(window.end).toBe(1_000_020 - 30);
    expect(window.end % 30).toBe(0);
    expect(window.end - window.start).toBe(3600);
  });

  it('keeps the rate window at four scrapes for short steps', () => {
    expect(metricsWindow('15m', 0).rateWindow).toBe('60s');
    expect(metricsWindow('24h', 0).rateWindow).toBe('300s');
  });
});

describe('projectQueries', () => {
  it('scopes every query to the namespace and escapes it', () => {
    const queries = projectQueries('project-"x', '60s');

    for (const query of Object.values(queries)) {
      expect(query).toContain('namespace="project-\\"x"');
      expect(query.startsWith('sum by (pod)')).toBe(true);
    }
    expect(queries.cpu_cores).toContain('[60s]');
    expect(queries.network_rx_bytes_per_second).toContain('interface!="lo"');
  });
});

describe('createPodResolver', () => {
  it('prefers the live workload label', () => {
    const resolve = createPodResolver(
      [web, webWorker],
      new Map([['custom-pod', 'w-web']]),
    );

    expect(resolve('custom-pod')).toBe('w-web');
  });

  it('matches gone pods on the longest external name prefix', () => {
    const resolve = createPodResolver([web, webWorker], new Map());

    expect(resolve('web-worker-6d8f9-abcde')).toBe('w-worker');
    expect(resolve('web-7c9b5-xyz12')).toBe('w-web');
    expect(resolve('benchmark-job-1')).toBeNull();
  });

  it('ignores labels of workloads that no longer exist', () => {
    const resolve = createPodResolver([web], new Map([['x', 'w-deleted']]));

    expect(resolve('x')).toBeNull();
  });
});

describe('foldSignal', () => {
  it('sums pods per workload and into the total, with others last', () => {
    const resolve = createPodResolver([web, webWorker], new Map());
    const signal = foldSignal(
      [
        {
          metric: { pod: 'web-a-1' },
          values: [
            [100, '1'],
            [130, '2'],
          ],
        },
        {
          metric: { pod: 'web-b-2' },
          values: [
            [100, '0.5'],
            [130, 'NaN'],
          ],
        },
        { metric: { pod: 'stray' }, values: [[130, '4']] },
      ],
      [webWorker, web],
      resolve,
    );

    expect(signal.total).toEqual([
      [100, 1.5],
      [130, 6],
    ]);
    expect(signal.by_workload).toEqual([
      {
        key: 'w-web',
        label: 'web',
        points: [
          [100, 1.5],
          [130, 2],
        ],
      },
      { key: 'other', label: 'Other', points: [[130, 4]] },
    ]);
    expect(lastValues(signal).get('w-web')).toBe(2);
  });
});

describe('scalarValue', () => {
  it('reads an instant sum or returns null', () => {
    expect(scalarValue([{ metric: {}, value: [1, '42'] }])).toBe(42);
    expect(scalarValue([])).toBeNull();
  });
});

describe('parseQuantity', () => {
  it.each([
    ['500m', 0.5],
    ['2', 2],
    ['512Mi', 512 * 1024 ** 2],
    ['1Gi', 1024 ** 3],
    ['1G', 1e9],
    ['1e3', 1000],
    ['100k', 100_000],
  ])('parses %s', (input, expected) => {
    expect(parseQuantity(input)).toBeCloseTo(expected);
  });

  it('rejects malformed values', () => {
    expect(parseQuantity('lots')).toBeNull();
    expect(parseQuantity('1Zi')).toBeNull();
    expect(parseQuantity(undefined)).toBeNull();
  });
});

describe('instanceQueries', () => {
  it('matches exactly the named pods of the namespace', () => {
    const queries = instanceQueries('project-a', ['web-1.x', 'web-2']);

    expect(queries.cpu_cores).toBe(
      'sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="project-a",pod=~"^(?:web-1\\\\.x|web-2)$",container!="",container!="POD"}[60s]))',
    );
    expect(queries.memory_bytes).toBe(
      'sum by (pod) (container_memory_working_set_bytes{namespace="project-a",pod=~"^(?:web-1\\\\.x|web-2)$",container!="",container!="POD"})',
    );
  });
});

describe('valuesByPod', () => {
  it('keys instant values by pod and drops unparsable ones', () => {
    expect(
      valuesByPod([
        { metric: { pod: 'a' }, value: [0, '0.5'] },
        { metric: { pod: 'b' }, value: [0, 'NaN'] },
        { metric: {}, value: [0, '1'] },
      ]),
    ).toEqual(new Map([['a', 0.5]]));
  });
});

describe('trafficQueries', () => {
  it('keeps both ends inside the project namespace', () => {
    const queries = trafficQueries('project-a');

    for (const promql of Object.values(queries)) {
      expect(promql).toContain(
        'source_namespace="project-a",destination_namespace="project-a"',
      );
    }
    expect(queries.opened).toContain('flag="SYN"');
    expect(queries.opened).not.toContain('increase(');
    expect(queries.recent).toContain('type="Trace"');
    expect(queries.activity).toContain('type="Trace"');
  });
});

describe('foldTraffic', () => {
  const db: WorkloadRef = { id: 'w-db', name: 'db', external_name: 'db' };
  const pair = (source: string, destination: string, value: string) => ({
    metric: { source_workload: source, destination_workload: destination },
    value: [0, value] as [number, string],
  });
  const both = (source: string, destination: string, value: string) => [
    pair(source, destination, value),
    pair(destination, source, value),
  ];

  it('points a link from client to server and sums both directions', () => {
    expect(
      foldTraffic(
        {
          opened: [pair('web', 'db', '12')],
          recent: both('web', 'db', '40'),
          activity: [pair('web', 'db', '2'), pair('db', 'web', '1.5')],
        },
        [web, db],
      ),
    ).toEqual([
      {
        source: 'w-web',
        target: 'w-db',
        two_way: false,
        flows_per_second: 3.5,
      },
    ]);
  });

  it('keeps a link whose connections were opened before the last hour', () => {
    expect(
      foldTraffic(
        {
          opened: [pair('web', 'db', '3')],
          recent: [pair('db', 'web', '90'), pair('web', 'db', '10')],
          activity: [],
        },
        [web, db],
      ),
    ).toEqual([
      {
        source: 'w-web',
        target: 'w-db',
        two_way: false,
        flows_per_second: 0,
      },
    ]);
  });

  it('takes the busier direction when no SYN was seen', () => {
    expect(
      foldTraffic(
        {
          opened: [],
          recent: [pair('db', 'web', '5'), pair('web', 'db', '20')],
          activity: [],
        },
        [web, db],
      ),
    ).toEqual([expect.objectContaining({ source: 'w-web', target: 'w-db' })]);
  });

  it('drops quiet links, unknown workloads and self pairs', () => {
    expect(
      foldTraffic(
        {
          opened: [
            pair('web', 'db', '1'),
            pair('web', 'web', '4'),
            pair('web', 'other', '4'),
          ],
          recent: [
            pair('web', 'web', '9'),
            pair('web', 'other', '9'),
            pair('web-worker', 'db', '0'),
          ],
          activity: [pair('web', 'web', '9')],
        },
        [web, webWorker, db],
      ),
    ).toEqual([]);
  });

  it('makes one two-way link when both sides open connections', () => {
    expect(
      foldTraffic(
        {
          opened: both('web', 'db', '1'),
          recent: both('web', 'db', '6'),
          activity: [pair('web', 'db', '2'), pair('db', 'web', '1')],
        },
        [web, db],
      ),
    ).toEqual([
      expect.objectContaining({ two_way: true, flows_per_second: 3 }),
    ]);
  });
});

describe('installer scrape config', () => {
  // install.sh keeps only the series it names, so a query on any other
  // metric would find no data.
  const installer = readFileSync(
    join(__dirname, '../../../../../../scripts/install.sh'),
    'utf8',
  );
  const kept = [
    ...installer.matchAll(
      /source_labels: \[__name__\]\s+action: keep\s+regex: (\S+)/g,
    ),
  ].map(([, regex]) => new RegExp(`^(?:${regex})$`));
  const queries = [
    projectQueries('ns', '1m'),
    postgresQueries('ns', '1m'),
    instanceQueries('ns', ['web-1']),
    volumeQueries('ns'),
    clusterUsageQueries,
    trafficQueries('ns'),
  ].flatMap((group) => Object.values(group));
  const metrics = new Set(
    queries.flatMap((query) =>
      [...query.matchAll(/([a-z_:][a-z0-9_:]*)\{/g)].map(([, name]) => name),
    ),
  );

  it('keeps every metric the API queries', () => {
    expect(kept.length).toBeGreaterThan(0);
    expect(metrics.size).toBeGreaterThan(10);
    expect(
      [...metrics].filter((name) => !kept.some((regex) => regex.test(name))),
    ).toEqual([]);
  });
});
