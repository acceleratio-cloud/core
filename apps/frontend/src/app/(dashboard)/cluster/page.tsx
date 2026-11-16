import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { getServerSession } from '@/api/auth/server';
import { ClusterView } from '@/modules/cluster/containers/cluster-view';

export default async function ClusterPage() {
  await connection();

  // Custom roles work inside their projects only.
  if ((await getServerSession())?.access?.role === 'custom') {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-8xl flex-1 flex-col">
      <ClusterView />
    </div>
  );
}
