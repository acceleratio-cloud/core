import type {
  CreateWorkloadPayload,
  S3BucketCredentials,
  UpdateInternalHostnamePayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadEnv,
  WorkloadInstancesSnapshot,
  WorkloadVersion,
  WorkloadVersionDiff,
  WorkloadVersionDiffQuery,
} from '@acceleratio/shared';

import { api, getApiBaseUrl } from '@/api';

type WorkloadAction = 'deploy' | 'start' | 'stop' | 'restart';

const postAction = async (
  projectId: string,
  id: string,
  action: WorkloadAction,
) => {
  const { data } = await api.post<Workload>(
    `/projects/${projectId}/workloads/${id}/${action}`,
  );
  return data;
};

export const workloadsApi = {
  list: async (projectId: string) => {
    const { data } = await api.get<Workload[]>(
      `/projects/${projectId}/workloads`,
    );
    return data;
  },
  eventsUrl: (projectId: string) => {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/projects/${projectId}/workloads/events`;
  },
  instances: async (projectId: string, id: string, signal?: AbortSignal) => {
    const { data } = await api.get<WorkloadInstancesSnapshot>(
      `/projects/${projectId}/workloads/${id}/instances`,
      { signal },
    );
    return data;
  },
  instancesEventsUrl: (projectId: string, id: string) => {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/projects/${projectId}/workloads/${id}/instances/events`;
  },
  /** WebSocket URL of an interactive shell in one instance (Pod). */
  terminalUrl: (
    projectId: string,
    id: string,
    pod: string,
    size: { cols: number; rows: number },
  ) => {
    // The API URL is a path ("/api") behind the control plane domain, so it
    // must be resolved against the page origin; `new URL("/api")` throws.
    const base = new URL(getApiBaseUrl() || '/', window.location.origin);
    base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = `${base.pathname.replace(/\/+$/, '')}/projects/${projectId}/workloads/${id}/instances/${encodeURIComponent(pod)}/terminal`;
    const url = new URL(path, base);
    url.searchParams.set('cols', String(size.cols));
    url.searchParams.set('rows', String(size.rows));
    return url.toString();
  },
  get: async (projectId: string, id: string) => {
    const { data } = await api.get<Workload>(
      `/projects/${projectId}/workloads/${id}`,
    );
    return data;
  },
  create: async (projectId: string, payload: CreateWorkloadPayload) => {
    const { data } = await api.post<Workload>(
      `/projects/${projectId}/workloads`,
      payload,
    );
    return data;
  },
  update: async (
    projectId: string,
    id: string,
    payload: UpdateWorkloadPayload,
  ) => {
    const { data } = await api.patch<Workload>(
      `/projects/${projectId}/workloads/${id}`,
      payload,
    );
    return data;
  },
  remove: async (projectId: string, id: string) => {
    await api.delete(`/projects/${projectId}/workloads/${id}`);
  },
  deploy: (projectId: string, id: string) =>
    postAction(projectId, id, 'deploy'),
  start: (projectId: string, id: string) => postAction(projectId, id, 'start'),
  stop: (projectId: string, id: string) => postAction(projectId, id, 'stop'),
  restart: (projectId: string, id: string) =>
    postAction(projectId, id, 'restart'),
  listVersions: async (projectId: string, id: string) => {
    const { data } = await api.get<WorkloadVersion[]>(
      `/projects/${projectId}/workloads/${id}/versions`,
    );
    return data;
  },
  getVersion: async (projectId: string, id: string, versionId: string) => {
    const { data } = await api.get<WorkloadVersion>(
      `/projects/${projectId}/workloads/${id}/versions/${versionId}`,
    );
    return data;
  },
  /**
   * What differs between two sides: `active`, `draft` or a version id. The
   * server compares variable values and returns only that they changed.
   */
  diffVersions: async (
    projectId: string,
    id: string,
    query: WorkloadVersionDiffQuery,
    signal?: AbortSignal,
  ) => {
    const { data } = await api.get<WorkloadVersionDiff>(
      `/projects/${projectId}/workloads/${id}/versions/diff`,
      { params: query, signal },
    );
    return data;
  },
  /** What a rollback to the version would change, before it runs. */
  previewRollback: async (
    projectId: string,
    id: string,
    versionId: string,
    signal?: AbortSignal,
  ) => {
    const { data } = await api.get<WorkloadVersionDiff>(
      `/projects/${projectId}/workloads/${id}/versions/${versionId}/rollback/preview`,
      { signal },
    );
    return data;
  },
  rollback: async (projectId: string, id: string, versionId: string) => {
    const { data } = await api.post<Workload>(
      `/projects/${projectId}/workloads/${id}/versions/${versionId}/rollback`,
    );
    return data;
  },
  /** Environment variables of a Docker service, values included. */
  getEnv: async (projectId: string, id: string) => {
    const { data } = await api.get<WorkloadEnv>(
      `/projects/${projectId}/workloads/${id}/env`,
    );
    return data;
  },
  /** Endpoint and keys of an S3 bucket, including the secret key. */
  getCredentials: async (projectId: string, id: string) => {
    const { data } = await api.get<S3BucketCredentials>(
      `/projects/${projectId}/workloads/${id}/credentials`,
    );
    return data;
  },
  /** Renames the private `<hostname>.internal` name; applies at once. */
  updateInternalHostname: async (
    projectId: string,
    id: string,
    payload: UpdateInternalHostnamePayload,
  ) => {
    const { data } = await api.patch<Workload>(
      `/projects/${projectId}/workloads/${id}/internal-hostname`,
      payload,
    );
    return data;
  },
  discardDraft: async (projectId: string, id: string) => {
    const { data } = await api.delete<Workload>(
      `/projects/${projectId}/workloads/${id}/draft`,
    );
    return data;
  },
};
