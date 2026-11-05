import type {
  CreateProjectPayload,
  Project,
  UpdateProjectPayload,
} from '@acceleratio/shared';

import { api } from '@/api';

export const projectsApi = {
  list: async () => {
    const { data } = await api.get<Project[]>('/projects');
    return data;
  },
  create: async (payload: CreateProjectPayload) => {
    const { data } = await api.post<Project>('/projects', payload);
    return data;
  },
  update: async (id: string, payload: UpdateProjectPayload) => {
    const { data } = await api.patch<Project>(`/projects/${id}`, payload);
    return data;
  },
  remove: async (id: string) => {
    await api.delete(`/projects/${id}`);
  },
};
