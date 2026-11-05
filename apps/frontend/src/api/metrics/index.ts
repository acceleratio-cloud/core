import type { MetricsRange, ProjectMetrics } from '@acceleratio/shared';

import { api } from '@/api';

export const metricsApi = {
  get: async (projectId: string, range: MetricsRange, signal?: AbortSignal) => {
    const { data } = await api.get<ProjectMetrics>(
      `/projects/${projectId}/metrics`,
      { params: { range }, signal },
    );
    return data;
  },
};
