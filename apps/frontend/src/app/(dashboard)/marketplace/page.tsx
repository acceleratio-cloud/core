import { connection } from 'next/server';

import { getServerMarketplaceApps } from '@/api/marketplace/server';
import { MarketplaceView } from '@/modules/marketplace/containers/marketplace-view';

export default async function MarketplacePage() {
  await connection();

  return <MarketplaceView apps={await getServerMarketplaceApps()} />;
}
