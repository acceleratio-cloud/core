import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
  WorkloadVersion,
} from '@acceleratio/shared';

import { api } from '@/api';

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
    const baseUrl = (api.defaults.baseURL ?? '').replace(/\/+$/, '');
    return `${baseUrl}/projects/${projectId}/workloads/events`;
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
  rollback: async (projectId: string, id: string, versionId: string) => {
    const { data } = await api.post<Workload>(
      `/projects/${projectId}/workloads/${id}/versions/${versionId}/rollback`,
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
