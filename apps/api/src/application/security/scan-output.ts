import {
  MAX_LISTED_VULNERABILITIES,
  VULNERABILITY_SEVERITIES,
  type Vulnerability,
  type VulnerabilityCounts,
  type VulnerabilitySeverity,
} from '@acceleratio/shared';

export interface ScanResult {
  counts: VulnerabilityCounts;
  fixable: number;
  /** Highest severity first, fixable first within it, capped. */
  vulnerabilities: Vulnerability[];
}

const MAX_TEXT = 300;

const text = (value: unknown, max = MAX_TEXT): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

const severityOf = (value: unknown): VulnerabilitySeverity => {
  const severity = typeof value === 'string' ? value.toLowerCase() : '';

  return (VULNERABILITY_SEVERITIES as readonly string[]).includes(severity)
    ? (severity as VulnerabilitySeverity)
    : 'unknown';
};

const rank = (severity: VulnerabilitySeverity) =>
  VULNERABILITY_SEVERITIES.indexOf(severity);

/**
 * Reads the scanner's log: one JSON object per vulnerability (`SCAN_TEMPLATE`)
 * among whatever else it printed. The same advisory on the same package
 * version is listed once, even when it shows up in several layers.
 */
export const parseScanOutput = (log: string): ScanResult => {
  const found = new Map<string, Vulnerability>();

  for (const line of log.split('\n')) {
    if (!line.startsWith('{')) {
      continue;
    }

    let item: Record<string, unknown>;

    try {
      item = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const id = text(item.id, 100);
    const pkg = text(item.pkg);
    const installed = text(item.installed, 200) ?? '';

    if (!id || !pkg) {
      continue;
    }

    found.set(`${id}\0${pkg}\0${installed}`, {
      id,
      severity: severityOf(item.severity),
      package: pkg,
      installed_version: installed,
      fixed_version: text(item.fixed, 200),
      title: text(item.title),
      kind:
        item.class === 'os-pkgs'
          ? 'os'
          : item.class === 'lang-pkgs'
            ? 'library'
            : null,
      ecosystem: text(item.type, 40),
    });
  }

  const all = [...found.values()].sort(
    (a, b) =>
      rank(a.severity) - rank(b.severity) ||
      Number(!a.fixed_version) - Number(!b.fixed_version) ||
      a.id.localeCompare(b.id) ||
      a.package.localeCompare(b.package),
  );
  const counts = Object.fromEntries(
    VULNERABILITY_SEVERITIES.map((severity) => [severity, 0]),
  ) as VulnerabilityCounts;

  for (const item of all) {
    counts[item.severity] += 1;
  }

  return {
    counts,
    fixable: all.filter((item) => item.fixed_version).length,
    vulnerabilities: all.slice(0, MAX_LISTED_VULNERABILITIES),
  };
};

/** The last line the scanner printed about an error, for a failed scan. */
export const scanFailureLine = (log: string | null): string | null =>
  log
    ?.split('\n')
    .reverse()
    .find((line) => !line.startsWith('{') && /error|fatal/i.test(line))
    ?.trim()
    .slice(0, 500) ?? null;
