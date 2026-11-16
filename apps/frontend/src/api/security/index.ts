import type {
  AcceptRiskPayload,
  ImageVulnerabilities,
  ProjectSecurity,
} from '@acceleratio/shared';

import { api } from '@/api';

const base = (projectId: string) =>
  `/projects/${encodeURIComponent(projectId)}/security`;

export const securityApi = {
  get: async (projectId: string, signal?: AbortSignal) => {
    const { data } = await api.get<ProjectSecurity>(base(projectId), {
      signal,
    });
    return data;
  },
  vulnerabilities: async (projectId: string, digest: string) => {
    const { data } = await api.get<ImageVulnerabilities>(
      `${base(projectId)}/images/${encodeURIComponent(digest)}`,
    );
    return data;
  },
  /** Queues every image of the project again. */
  scan: async (projectId: string) => {
    const { data } = await api.post<ProjectSecurity>(`${base(projectId)}/scan`);
    return data;
  },
  /** Hides a recommendation until it expires or grows. */
  acceptRisk: async (projectId: string, payload: AcceptRiskPayload) => {
    const { data } = await api.post<ProjectSecurity>(
      `${base(projectId)}/acceptances`,
      payload,
    );
    return data;
  },
  restoreRisk: async (projectId: string, recommendationId: string) => {
    const { data } = await api.delete<ProjectSecurity>(
      `${base(projectId)}/acceptances/${encodeURIComponent(recommendationId)}`,
    );
    return data;
  },
};
