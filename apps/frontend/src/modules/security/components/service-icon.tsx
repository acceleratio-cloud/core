import { PanelsTopLeft } from 'lucide-react';
import type { Workload } from '@acceleratio/shared';

import { WorkloadIcon } from '@/modules/workloads/components/workload-icon';
import { BucketIcon } from '@/shared/icons/bucket-icon';
import { DockerIcon } from '@/shared/icons/docker-icon';
import { GithubIcon } from '@/shared/icons/github-icon';
import { PostgresIcon } from '@/shared/icons/postgres-icon';

/** The service's own icon, or the mark of its type. */
export const ServiceIcon = ({
  workload,
}: {
  workload: Workload | undefined;
}) => {
  const className = 'size-4 shrink-0';

  return (
    <WorkloadIcon
      icon={workload?.icon}
      className={className}
      fallback={
        workload?.type === 's3_bucket' ? (
          <BucketIcon className={className} />
        ) : workload?.type === 'github' ? (
          <GithubIcon className={className} />
        ) : workload?.type === 'postgres' ? (
          <PostgresIcon className={className} />
        ) : workload?.type === 'static' ? (
          <PanelsTopLeft
            aria-hidden="true"
            strokeWidth={1.75}
            className={className}
          />
        ) : (
          <DockerIcon className={className} />
        )
      }
    />
  );
};
