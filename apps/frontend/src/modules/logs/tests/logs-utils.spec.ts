import { describe, expect, it } from 'bun:test';

import type { ProjectLogEntry } from '@acceleratio/shared';
import {
  appendOlder,
  prependLive,
  toLogFile,
} from '@/modules/logs/utils/entries';
import {
  formatLogTime,
  logTimeMs,
  prettyMessage,
  shortPodName,
} from '@/modules/logs/utils/format';
import { splitMatches } from '@/modules/logs/utils/highlight';
import { projectLogsHref } from '@/modules/logs/utils/links';

const entry = (id: string, time = '2026-11-07T12:00:00Z'): ProjectLogEntry => ({
  id,
  time,
  message: `line ${id}`,
  level: null,
  stream: 'stdout',
  workload_id: 'w-1',
  pod: 'api-7df88758b-2hnxs',
  container: 'main',
});

describe('prependLive', () => {
  it('puts the newest live line on top and skips repeats', () => {
    const { entries, trimmed } = prependLive(
      [entry('b'), entry('a')],
      [entry('b'), entry('c'), entry('d')],
      10,
    );

    expect(entries.map((e) => e.id)).toEqual(['d', 'c', 'b', 'a']);
    expect(trimmed).toBe(0);
  });

  it('keeps at most the limit, dropping the oldest', () => {
    const { entries, trimmed } = prependLive(
      [entry('b'), entry('a')],
      [entry('c'), entry('d')],
      3,
    );

    expect(entries.map((e) => e.id)).toEqual(['d', 'c', 'b']);
    expect(trimmed).toBe(1);
  });

  it('returns the same list when nothing is new', () => {
    const current = [entry('a')];

    expect(prependLive(current, [entry('a')], 10).entries).toBe(current);
  });
});

describe('appendOlder', () => {
  it('adds an older page below without repeating the boundary line', () => {
    expect(
      appendOlder([entry('c'), entry('b')], [entry('b'), entry('a')]).map(
        (e) => e.id,
      ),
    ).toEqual(['c', 'b', 'a']);
  });
});

describe('toLogFile', () => {
  it('writes oldest first with level, service and pod', () => {
    expect(
      toLogFile(
        [{ ...entry('b', '2026-11-07T12:00:01Z'), level: 'error' }, entry('a')],
        () => 'api',
      ),
    ).toBe(
      [
        '2026-11-07T12:00:00Z -     api/api-7df88758b-2hnxs line a',
        '2026-11-07T12:00:01Z ERROR api/api-7df88758b-2hnxs line b',
      ].join('\n'),
    );
  });
});

describe('format', () => {
  it('reads nanosecond timestamps', () => {
    expect(logTimeMs('2026-11-07T12:00:00.123456789Z')).toBe(
      Date.parse('2026-11-07T12:00:00.123Z'),
    );
  });

  it('drops the date for lines from today', () => {
    const now = Date.parse('2026-11-07T18:00:00Z');

    expect(formatLogTime('2026-11-07T12:03:04.5Z', true, now)).toBe(
      '12:03:04.500',
    );
    expect(formatLogTime('2026-11-06T12:03:04.5Z', true, now)).toBe(
      'Nov 06 12:03:04.500',
    );
  });

  it('shortens pod names to their stable tail', () => {
    expect(shortPodName('web-b190da2b-759d889854-mnhcs')).toBe(
      '759d889854-mnhcs',
    );
    expect(shortPodName('postgres-0', 'postgres')).toBe('postgres');
  });

  it('pretty-prints JSON messages only', () => {
    expect(prettyMessage('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyMessage('{not json')).toBe('{not json');
    expect(prettyMessage('plain')).toBe('plain');
  });
});

describe('splitMatches', () => {
  it('marks case-insensitive matches', () => {
    expect(splitMatches('Timeout after timeout', 'TIMEOUT')).toEqual([
      { text: 'Timeout', match: true },
      { text: ' after ', match: false },
      { text: 'timeout', match: true },
    ]);
  });

  it('returns the text unchanged without a phrase', () => {
    expect(splitMatches('abc', ' ')).toEqual([{ text: 'abc', match: false }]);
  });
});

describe('projectLogsHref', () => {
  it('opens the Logs tab filtered to a service and pod', () => {
    expect(projectLogsHref('p-1', { service: 'w-1', pod: 'api-1' })).toBe(
      '/project/p-1?tab=logs&service=w-1&pod=api-1',
    );
  });
});
