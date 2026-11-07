import {
  escapeRegex,
  filterQuery,
  formatCursor,
  nextCursor,
  parseCursor,
  foldHistogram,
  histogramStep,
  pageQuery,
  quote,
  sourcesQuery,
  tailQuery,
  toLogEntry,
  type LogFilters,
} from '../logs-query';

const namespace = 'project-2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';

const filters = (overrides: Partial<LogFilters> = {}): LogFilters => ({
  workloadIds: [],
  pods: [],
  levels: [],
  search: null,
  ...overrides,
});

describe('filterQuery', () => {
  it('always starts with the project namespace stream', () => {
    expect(filterQuery(namespace, filters())).toBe(
      `{namespace="${namespace}"}`,
    );
  });

  it('narrows by service, pod, level and search', () => {
    expect(
      filterQuery(
        namespace,
        filters({
          workloadIds: ['a', 'b'],
          pods: ['web-1'],
          levels: ['error', 'warn'],
          search: 'timeout',
        }),
      ),
    ).toBe(
      `{namespace="${namespace}"} workload_id:in("a", "b") pod:in("web-1") level:in("error", "warn") ~"(?i)timeout"`,
    );
  });

  it('searches for a literal, case-insensitive substring', () => {
    expect(filterQuery(namespace, filters({ search: 'GET /api?x=1' }))).toBe(
      `{namespace="${namespace}"} ~"(?i)GET /api\\\\?x=1"`,
    );
    expect(escapeRegex('a.b*(c)[d]{e}|f^$+\\')).toBe(
      'a\\.b\\*\\(c\\)\\[d\\]\\{e\\}\\|f\\^\\$\\+\\\\',
    );
  });

  it('matches lines without a level for "unknown"', () => {
    expect(filterQuery(namespace, filters({ levels: ['unknown'] }))).toBe(
      `{namespace="${namespace}"} level:""`,
    );
    expect(
      filterQuery(namespace, filters({ levels: ['error', 'unknown'] })),
    ).toBe(`{namespace="${namespace}"} (level:in("error") OR level:"")`);
  });

  it('keeps search text inside a quoted literal', () => {
    const hostile = '") OR {namespace="other"} | delete ("';
    const query = filterQuery(namespace, filters({ search: hostile }));

    expect(query).toBe(
      `{namespace="${namespace}"} ~${quote(`(?i)${escapeRegex(hostile)}`)}`,
    );
    expect(query.startsWith(`{namespace="${namespace}"} `)).toBe(true);
    // Everything after `~` is one string literal: the quote inside the text
    // is escaped, so the literal never closes early.
    const literal = query.slice(`{namespace="${namespace}"} ~`.length);

    expect(JSON.parse(literal)).toBe(`(?i)${escapeRegex(hostile)}`);
  });

  it('escapes control characters and backslashes', () => {
    expect(quote('a\\b\n"c"')).toBe('"a\\\\b\\n\\"c\\""');
  });
});

describe('pageQuery', () => {
  const window = {
    start: Date.parse('2026-11-07T10:00:00Z'),
    end: Date.parse('2026-11-07T11:00:00Z'),
  };

  it('reads the newest lines of the window first', () => {
    expect(pageQuery(namespace, filters(), window, 200, null)).toBe(
      `{namespace="${namespace}"} _time:[2026-11-07T10:00:00.000Z, 2026-11-07T11:00:00.000Z) | sort by (_time desc, _stream_id desc) limit 200 | fields _time, _msg, _stream_id, level, stream, workload_id, pod, container`,
    );
  });

  it('continues at the cursor time, skipping lines already returned', () => {
    expect(
      pageQuery(namespace, filters(), window, 50, {
        time: '2026-11-07T10:30:00.123456789Z',
        skip: 2,
      }),
    ).toContain(
      '_time:<=2026-11-07T10:30:00.123456789Z | sort by (_time desc, _stream_id desc) offset 2 limit 50',
    );
  });
});

describe('cursors', () => {
  it('round-trips and accepts a bare time', () => {
    expect(parseCursor('2026-11-07T10:30:00.5Z~3')).toEqual({
      time: '2026-11-07T10:30:00.5Z',
      skip: 3,
    });
    expect(parseCursor('2026-11-07T10:30:00Z')).toEqual({
      time: '2026-11-07T10:30:00Z',
      skip: 0,
    });
    expect(formatCursor({ time: 't', skip: 1 })).toBe('t~1');
    expect(parseCursor('yesterday')).toBeNull();
    expect(parseCursor('2026-11-07T10:30:00Z~x')).toBeNull();
    expect(parseCursor('2026-11-07T10:30:00Z~1~2')).toBeNull();
  });

  it('counts the lines that share the last timestamp', () => {
    expect(nextCursor(['c', 'b', 'a', 'a'], 4, null)).toEqual({
      time: 'a',
      skip: 2,
    });
    expect(nextCursor(['c', 'b'], 4, null)).toBeNull();
  });

  it('adds the previous skip when a whole page shares one timestamp', () => {
    expect(nextCursor(['a', 'a'], 2, { time: 'a', skip: 2 })).toEqual({
      time: 'a',
      skip: 4,
    });
  });
});

describe('tailQuery', () => {
  it('has no time window or sorting pipes', () => {
    expect(tailQuery(namespace, filters(), null)).toBe(
      `{namespace="${namespace}"} | fields _time, _msg, _stream_id, level, stream, workload_id, pod, container`,
    );
  });

  it('resumes after the newest line the client has', () => {
    expect(tailQuery(namespace, filters(), '2026-11-07T10:30:00.5Z')).toContain(
      '_time:>2026-11-07T10:30:00.5Z | fields',
    );
  });
});

describe('sourcesQuery', () => {
  it('counts lines per service and pod in the project only', () => {
    const query = sourcesQuery(namespace, {
      start: Date.parse('2026-11-07T10:00:00Z'),
      end: Date.parse('2026-11-07T11:00:00Z'),
    });

    expect(query.startsWith(`{namespace="${namespace}"} _time:[`)).toBe(true);
    expect(query).toContain('stats by (workload_id, pod) count() lines');
  });
});

describe('histogramStep', () => {
  it('aims for about sixty buckets', () => {
    expect(histogramStep({ start: 0, end: 15 * 60 * 1000 })).toBe(15);
    expect(histogramStep({ start: 0, end: 60 * 60 * 1000 })).toBe(60);
    expect(histogramStep({ start: 0, end: 24 * 60 * 60 * 1000 })).toBe(1800);
    expect(histogramStep({ start: 0, end: 7 * 24 * 60 * 60 * 1000 })).toBe(
      10800,
    );
  });
});

describe('foldHistogram', () => {
  it('fills a full grid and folds unknown values together', () => {
    const { buckets, total } = foldHistogram(
      [
        {
          fields: { level: 'error' },
          timestamps: ['1970-01-01T00:01:00Z'],
          values: [3],
          total: 3,
        },
        {
          fields: { level: '' },
          timestamps: ['1970-01-01T00:00:00Z', '1970-01-01T00:02:00Z'],
          values: [1, 2],
          total: 3,
        },
        {
          fields: { level: 'notice' },
          timestamps: ['1970-01-01T00:02:00Z'],
          values: [4],
          total: 4,
        },
      ],
      0,
      180,
      60,
    );

    expect(buckets).toEqual([
      { time: 0, error: 0, warn: 0, info: 0, debug: 0, unknown: 1 },
      { time: 60, error: 3, warn: 0, info: 0, debug: 0, unknown: 0 },
      { time: 120, error: 0, warn: 0, info: 0, debug: 0, unknown: 6 },
    ]);
    expect(total).toBe(10);
  });
});

describe('toLogEntry', () => {
  it('maps a stored record', () => {
    expect(
      toLogEntry({
        _time: '2026-11-07T10:00:00.000000001Z',
        _msg: 'boom',
        _stream_id: 'abc',
        level: 'error',
        stream: 'stderr',
        workload_id: 'w-1',
        pod: 'api-1',
        container: 'main',
      }),
    ).toEqual({
      id: 'abc:2026-11-07T10:00:00.000000001Z',
      time: '2026-11-07T10:00:00.000000001Z',
      message: 'boom',
      level: 'error',
      stream: 'stderr',
      workload_id: 'w-1',
      pod: 'api-1',
      container: 'main',
    });
  });

  it('reads missing or unexpected fields as null', () => {
    expect(
      toLogEntry({ _time: 't', _msg: 'x', level: 'loud', workload_id: '' }),
    ).toMatchObject({ level: null, stream: null, workload_id: null, pod: '' });
  });
});
