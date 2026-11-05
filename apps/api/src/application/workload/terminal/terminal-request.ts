const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Kubernetes object names: DNS-1123 subdomain. */
const POD_NAME_PATTERN = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const TERMINAL_PATH_PATTERN =
  /^\/projects\/([^/]+)\/workloads\/([^/]+)\/instances\/([^/]+)\/terminal\/?$/;

export const DEFAULT_COLS = 80;
export const DEFAULT_ROWS = 24;
export const MAX_DIMENSION = 1000;

export interface TerminalRequest {
  projectId: string;
  workloadId: string;
  pod: string;
  cols: number;
  rows: number;
}

/** A terminal dimension from the client, or the fallback when it is unusable. */
export const toDimension = (value: unknown, fallback: number): number => {
  const number = typeof value === 'string' ? Number(value) : value;

  return typeof number === 'number' &&
    Number.isInteger(number) &&
    number > 0 &&
    number <= MAX_DIMENSION
    ? number
    : fallback;
};

export const isTerminalPath = (url: string | undefined): boolean =>
  TERMINAL_PATH_PATTERN.test(new URL(url ?? '/', 'http://local').pathname);

/**
 * The target of `/projects/:projectId/workloads/:id/instances/:pod/terminal`,
 * or null when the path does not match or a segment is malformed.
 */
export const parseTerminalRequest = (
  url: string | undefined,
): TerminalRequest | null => {
  const parsed = new URL(url ?? '/', 'http://local');
  const match = TERMINAL_PATH_PATTERN.exec(parsed.pathname);

  if (!match) {
    return null;
  }

  const [, projectId, workloadId, rawPod] = match;
  let pod: string;

  try {
    pod = decodeURIComponent(rawPod);
  } catch {
    return null;
  }

  if (
    !UUID_PATTERN.test(projectId) ||
    !UUID_PATTERN.test(workloadId) ||
    !POD_NAME_PATTERN.test(pod)
  ) {
    return null;
  }

  return {
    projectId,
    workloadId,
    pod,
    cols: toDimension(parsed.searchParams.get('cols'), DEFAULT_COLS),
    rows: toDimension(parsed.searchParams.get('rows'), DEFAULT_ROWS),
  };
};
