import type {
  DeployMarketplaceAppPayload,
  MarketplaceDeployment,
} from '@acceleratio/shared';

import { api } from '@/api';

export const marketplaceApi = {
  deploy: async (slug: string, payload: DeployMarketplaceAppPayload) => {
    const { data } = await api.post<MarketplaceDeployment>(
      `/marketplace/apps/${slug}/deploy`,
      payload,
    );
    return data;
  },
};
