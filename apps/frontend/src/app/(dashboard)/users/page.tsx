import { notFound } from 'next/navigation';
import { connection } from 'next/server';

import { getServerSession } from '@/api/auth/server';
import { UsersView } from '@/modules/members/containers/users-view';

export default async function UsersPage() {
  await connection();

  // Custom roles work inside their projects only.
  if ((await getServerSession())?.access?.role === 'custom') {
    notFound();
  }

  return <UsersView />;
}
