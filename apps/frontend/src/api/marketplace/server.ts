import 'server-only';

import { cookies } from 'next/headers';
import type { MarketplaceApp } from '@acceleratio/shared';

import { api } from '@/api';

export const getServerMarketplaceApps = async (): Promise<MarketplaceApp[]> => {
  const cookieStore = await cookies();
  const { data } = await api.get<MarketplaceApp[]>('/marketplace/apps', {
    headers: { cookie: cookieStore.toString() },
  });

  return data;
};
