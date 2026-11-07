'use client';

import type { DockerWorkloadConfig, WorkloadConfig } from '@acceleratio/shared';
import { DockerVersionConfig } from '@/modules/workloads/components/workload-details/docker-version-config';
import { useStorageProfiles } from '@/modules/workloads/hooks/use-storage-profiles';

/** A Docker version's full settings, with storage profiles named. */
export const DockerVersionDetails = ({
  config,
}: {
  config: WorkloadConfig;
}) => {
  const profiles = useStorageProfiles();

  const profileName = (id: string | null) => {
    if (profiles.status !== 'ready') {
      return id === null ? 'Platform profile' : 'Storage profile';
    }

    const profile =
      id === null
        ? profiles.profiles.find((candidate) => candidate.kind === 'platform')
        : profiles.profiles.find((candidate) => candidate.id === id);

    return (
      profile?.name ?? (id === null ? 'Platform profile' : 'Deleted profile')
    );
  };

  return (
    <DockerVersionConfig
      // Versions of a Docker service hold Docker configs.
      config={config as DockerWorkloadConfig}
      profileName={profileName}
    />
  );
};
