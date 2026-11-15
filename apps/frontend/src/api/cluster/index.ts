import type { ClusterCapacityOverview } from '@acceleratio/shared';

import { api } from '@/api';

export const clusterApi = {
  capacity: async () => {
    const { data } =
      await api.get<ClusterCapacityOverview>('/cluster/capacity');
    return data;
  },
};
