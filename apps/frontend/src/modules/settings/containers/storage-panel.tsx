'use client';

import { useCallback, useState } from 'react';

import type { StorageClass } from '@acceleratio/shared';
import { StorageBenchmarkHistory } from './storage-benchmark-history';
import { StorageSettings } from './storage-settings';

/** Storage profiles, with the benchmark history below them. */
export const StoragePanel = () => {
  const [profiles, setProfiles] = useState<StorageClass[]>([]);
  const [historyKey, setHistoryKey] = useState(0);
  const refreshHistory = useCallback(
    () => setHistoryKey((current) => current + 1),
    [],
  );

  return (
    <div className="flex flex-col gap-4">
      <StorageSettings
        onBenchmarkStarted={refreshHistory}
        onProfilesChange={setProfiles}
      />
      <StorageBenchmarkHistory profiles={profiles} refreshKey={historyKey} />
    </div>
  );
};
