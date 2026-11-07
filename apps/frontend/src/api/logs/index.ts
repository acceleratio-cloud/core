import type {
  LogLevelFilter,
  LogRange,
  ProjectLogHistogram,
  ProjectLogSources,
  ProjectLogsPage,
} from '@acceleratio/shared';

import { api, getApiBaseUrl } from '@/api';

/** A preset window ending now, or a fixed one (RFC 3339). */
export type LogWindowQuery =
  { range: LogRange } | { start: string; end: string };

export type LogFilterQuery = {
  workloadIds: string[];
  pods: string[];
  levels: LogLevelFilter[];
  search: string;
};

/**
 * Lists travel comma-joined (`workload=a,b`): ids, pod names and levels never
 * contain commas, and the API reads both this and repeated keys.
 */
const filterParams = (filters: LogFilterQuery): Record<string, string> => {
  const params: Record<string, string> = {};

  if (filters.workloadIds.length > 0) {
    params.workload = filters.workloadIds.join(',');
  }

  if (filters.pods.length > 0) {
    params.pod = filters.pods.join(',');
  }

  if (filters.levels.length > 0) {
    params.level = filters.levels.join(',');
  }

  if (filters.search.trim()) {
    params.q = filters.search.trim();
  }

  return params;
};

const windowParams = (window: LogWindowQuery): Record<string, string> =>
  'range' in window
    ? { range: window.range }
    : { start: window.start, end: window.end };

export const logsApi = {
  /** History, newest first; pass `next_cursor` back as `cursor`. */
  page: async (
    projectId: string,
    window: LogWindowQuery,
    filters: LogFilterQuery,
    options: { cursor?: string | null; limit?: number; signal?: AbortSignal },
  ) => {
    const { data } = await api.get<ProjectLogsPage>(
      `/projects/${projectId}/logs`,
      {
        params: {
          ...windowParams(window),
          ...filterParams(filters),
          ...(options.cursor ? { cursor: options.cursor } : {}),
          ...(options.limit ? { limit: `${options.limit}` } : {}),
        },
        signal: options.signal,
      },
    );
    return data;
  },
  histogram: async (
    projectId: string,
    window: LogWindowQuery,
    filters: LogFilterQuery,
    signal?: AbortSignal,
  ) => {
    const { data } = await api.get<ProjectLogHistogram>(
      `/projects/${projectId}/logs/histogram`,
      { params: { ...windowParams(window), ...filterParams(filters) }, signal },
    );
    return data;
  },
  sources: async (
    projectId: string,
    window: LogWindowQuery,
    signal?: AbortSignal,
  ) => {
    const { data } = await api.get<ProjectLogSources>(
      `/projects/${projectId}/logs/sources`,
      { params: windowParams(window), signal },
    );
    return data;
  },
  /** Server-sent events URL of the live tail, resuming after `since`. */
  streamUrl: (
    projectId: string,
    filters: LogFilterQuery,
    since: string | null,
  ) => {
    const params = new URLSearchParams(filterParams(filters));

    if (since) {
      params.set('since', since);
    }

    const query = params.toString();

    return `${getApiBaseUrl()}/projects/${projectId}/logs/stream${query ? `?${query}` : ''}`;
  },
};
