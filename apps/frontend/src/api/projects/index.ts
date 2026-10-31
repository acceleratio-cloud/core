import type { CreateProjectPayload, Project } from "@acceleratio/shared";

import { api } from "@/api";

export const projectsApi = {
  list: async () => {
    const { data } = await api.get<Project[]>("/projects");
    return data;
  },
  create: async (payload: CreateProjectPayload) => {
    const { data } = await api.post<Project>("/projects", payload);
    return data;
  },
};
