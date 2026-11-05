import type {
  AddWorkloadDomainPayload,
  GenerateWorkloadDomainPayload,
  UpdateWorkloadDomainPayload,
  WorkloadDomain,
  WorkloadDomains,
} from '@acceleratio/shared';

import { api } from '@/api';

const base = (projectId: string, id: string) =>
  `/projects/${projectId}/workloads/${id}/domains`;

/** Domains of a Docker service. Every call applies at once, without a deploy. */
export const workloadDomainsApi = {
  list: async (projectId: string, id: string) => {
    const { data } = await api.get<WorkloadDomains>(base(projectId, id));
    return data;
  },
  generate: async (
    projectId: string,
    id: string,
    payload: GenerateWorkloadDomainPayload,
  ) => {
    const { data } = await api.post<WorkloadDomain>(
      `${base(projectId, id)}/generate`,
      payload,
    );
    return data;
  },
  add: async (
    projectId: string,
    id: string,
    payload: AddWorkloadDomainPayload,
  ) => {
    const { data } = await api.post<WorkloadDomain>(
      base(projectId, id),
      payload,
    );
    return data;
  },
  update: async (
    projectId: string,
    id: string,
    domainId: string,
    payload: UpdateWorkloadDomainPayload,
  ) => {
    const { data } = await api.patch<WorkloadDomain>(
      `${base(projectId, id)}/${domainId}`,
      payload,
    );
    return data;
  },
  verify: async (projectId: string, id: string, domainId: string) => {
    const { data } = await api.post<WorkloadDomain>(
      `${base(projectId, id)}/${domainId}/verify`,
    );
    return data;
  },
  remove: async (projectId: string, id: string, domainId: string) => {
    await api.delete(`${base(projectId, id)}/${domainId}`);
  },
};
