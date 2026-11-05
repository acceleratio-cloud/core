import type { ClusterNode } from "@acceleratio/shared";

import { api } from "@/api";

export const nodesApi = {
  list: async () => {
    const { data } = await api.get<ClusterNode[]>("/nodes");
    return data;
  },
};
