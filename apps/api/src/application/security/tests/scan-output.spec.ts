import { MAX_LISTED_VULNERABILITIES } from '@acceleratio/shared';
import { parseScanOutput, scanFailureLine } from '../scan-output';

const line = (fields: Record<string, string>) => JSON.stringify(fields);

describe('parseScanOutput', () => {
  it('reads vulnerabilities, ranks them and counts by severity', () => {
    const log = [
      '2026-11-15T18:40:00Z INFO Need to update DB',
      line({
        id: 'CVE-2 ',
        severity: 'LOW',
        pkg: 'zlib',
        installed: '1.3',
        fixed: '',
        title: 'Low one',
      }),
      line({
        id: 'CVE-1',
        severity: 'CRITICAL',
        pkg: 'openssl',
        installed: '3.0',
        fixed: '3.1',
        title: 'Critical one',
      }),
      line({
        id: 'CVE-3',
        severity: 'CRITICAL',
        pkg: 'libc',
        installed: '2.36',
        fixed: '',
        title: '',
      }),
      line({ id: 'GHSA-x', severity: 'WEIRD', pkg: 'qs', installed: '6' }),
      '{not json',
    ].join('\n');

    const result = parseScanOutput(log);

    expect(result.counts).toEqual({
      critical: 2,
      high: 0,
      medium: 0,
      low: 1,
      unknown: 1,
    });
    expect(result.fixable).toBe(1);
    expect(result.vulnerabilities.map((item) => item.id)).toEqual([
      'CVE-1',
      'CVE-3',
      'CVE-2',
      'GHSA-x',
    ]);
    expect(result.vulnerabilities[1]).toEqual({
      id: 'CVE-3',
      severity: 'critical',
      package: 'libc',
      installed_version: '2.36',
      fixed_version: null,
      title: null,
      kind: null,
      ecosystem: null,
    });
  });

  it('tells distribution packages from application dependencies', () => {
    const result = parseScanOutput(
      [
        line({
          id: 'A',
          severity: 'HIGH',
          pkg: 'libc6',
          installed: '2',
          class: 'os-pkgs',
          type: 'debian',
        }),
        line({
          id: 'B',
          severity: 'HIGH',
          pkg: 'qs',
          installed: '6',
          class: 'lang-pkgs',
          type: 'npm',
        }),
      ].join('\n'),
    );

    expect(
      result.vulnerabilities.map((item) => [item.kind, item.ecosystem]),
    ).toEqual([
      ['os', 'debian'],
      ['library', 'npm'],
    ]);
  });

  it('lists an advisory on the same package version once', () => {
    const item = line({
      id: 'CVE-1',
      severity: 'HIGH',
      pkg: 'otel',
      installed: '1.0',
      fixed: '1.1',
    });
    const other = line({
      id: 'CVE-1',
      severity: 'HIGH',
      pkg: 'otel/log',
      installed: '1.0',
      fixed: '1.1',
    });

    const result = parseScanOutput([item, item, other].join('\n'));

    expect(result.vulnerabilities).toHaveLength(2);
    expect(result.counts.high).toBe(2);
  });

  it('caps the list but counts everything', () => {
    const log = Array.from({ length: MAX_LISTED_VULNERABILITIES + 5 }, (_, n) =>
      line({ id: `CVE-${n}`, severity: 'MEDIUM', pkg: 'p', installed: '1' }),
    ).join('\n');

    const result = parseScanOutput(log);

    expect(result.vulnerabilities).toHaveLength(MAX_LISTED_VULNERABILITIES);
    expect(result.counts.medium).toBe(MAX_LISTED_VULNERABILITIES + 5);
  });

  it('skips entries without an id or a package', () => {
    expect(
      parseScanOutput(line({ id: '', pkg: 'x', severity: 'HIGH' }))
        .vulnerabilities,
    ).toEqual([]);
  });
});

describe('scanFailureLine', () => {
  it('takes the last error line that is not a finding', () => {
    expect(
      scanFailureLine(
        [
          'INFO starting',
          'FATAL Fatal error: unable to find the image',
          '{"id":"error"}',
        ].join('\n'),
      ),
    ).toBe('FATAL Fatal error: unable to find the image');
    expect(scanFailureLine('all good')).toBeNull();
    expect(scanFailureLine(null)).toBeNull();
  });
});
