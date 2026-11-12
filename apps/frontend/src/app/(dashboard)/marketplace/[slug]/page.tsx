import '@xyflow/react/dist/style.css';
import { notFound } from 'next/navigation';

import { connection } from 'next/server';

import { getServerMarketplaceApps } from '@/api/marketplace/server';
import { MarketplaceAppView } from '@/modules/marketplace/containers/marketplace-app-view';

export default async function MarketplaceAppPage({
  params,
}: PageProps<'/marketplace/[slug]'>) {
  await connection();

  const [{ slug }, apps] = await Promise.all([
    params,
    getServerMarketplaceApps(),
  ]);
  const app = apps.find((item) => item.slug === slug);
  if (!app) notFound();

  return <MarketplaceAppView app={app} apps={apps} />;
}
