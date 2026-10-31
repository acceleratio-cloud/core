import type {
  CreateWorkloadPayload,
  UpdateWorkloadPayload,
  Workload,
} from "@acceleratio/shared";

import { api } from "@/api";

export const workloadsApi = {
  list: async (projectId: string) => {
    const { data } = await api.get<Workload[]>(
      `/projects/${projectId}/workloads`,
    );
    return data;
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
};
