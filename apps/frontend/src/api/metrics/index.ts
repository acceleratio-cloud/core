import type {
  MetricsRange,
  ProjectMetrics,
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
  volumes: async (projectId: string) => {
    const { data } = await api.get<VolumeUsage[]>(
      `/projects/${projectId}/metrics/volumes`,
    );
    return data;
  },
};
