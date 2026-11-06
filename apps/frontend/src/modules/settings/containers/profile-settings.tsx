'use client';

import { AccountCard } from './account-card';
import { SessionsList } from './sessions-list';

export const ProfileSettings = () => {
  return (
    <div className="space-y-4">
      <AccountCard />
      <SessionsList />
    </div>
  );
};
