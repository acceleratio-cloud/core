import type {
  MetricsRange,
  ProjectMetrics,
  ProjectTraffic,
  VolumeUsage,
} from '@acceleratio/shared';

import { api } from '@/api';

export const metricsApi = {
  get: async (projectId: string, range: MetricsRange, signal?: AbortSignal) => {
    const { data } = await api.get<ProjectMetrics>(
      `/projects/${projectId}/metrics`,
      { params: { range }, signal },
    );
    return data;
  },
  traffic: async (projectId: string, signal?: AbortSignal) => {
    const { data } = await api.get<ProjectTraffic>(
      `/projects/${projectId}/metrics/traffic`,
      { signal },
    );
    return data;
  },
  volumes: async (projectId: string) => {
    const { data } = await api.get<VolumeUsage[]>(
      `/projects/${projectId}/metrics/volumes`,
    );
    return data;
  },
};
