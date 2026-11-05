'use client';

import { useCallback } from 'react';

import type { Workload, WorkloadInstance } from '@acceleratio/shared';
import { useTerminal } from '@/modules/terminal/providers/terminal-provider';
import {
  DetailNotice,
  DetailStack,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import { WorkloadFailureNotice } from '@/modules/workloads/components/workload-details/workload-common-sections';
import { WorkloadInstancesList } from '@/modules/workloads/components/workload-details/workload-instances-list';
import { useWorkloadInstances } from '@/modules/workloads/hooks/use-workload-instances';

const emptyHintFor = (workload: Workload) => {
  switch (workload.status) {
    case 'draft':
      return 'Deploy the service to start one.';
    case 'stopped':
      return 'The service is stopped; start it to run an instance.';
    case 'deploying':
      return 'Instances appear here as the rollout starts them.';
    default:
      return 'They appear here as soon as they are scheduled.';
  }
};

/**
 * Overview of a Docker service: the deployment failure if there is one and
 * the live list of its instances.
 */
export const DockerWorkloadInstances = ({
  workload,
}: {
  workload: Workload;
}) => {
  const { data, error, isLive } = useWorkloadInstances(
    workload.project_id,
    workload.id,
  );
  const { openTerminal, canOpen } = useTerminal();

  const handleOpenTerminal = useCallback(
    (instance: WorkloadInstance) =>
      openTerminal({
        projectId: workload.project_id,
        workloadId: workload.id,
        workloadName: workload.name,
        pod: instance.name,
      }),
    [openTerminal, workload.project_id, workload.id, workload.name],
  );

  return (
    <DetailStack>
      <WorkloadFailureNotice workload={workload} />

      {error ? (
        <DetailNotice title="Instances may be out of date" message={error} />
      ) : null}

      {data && !data.metrics_available ? (
        <DetailNotice
          title="Usage unavailable"
          message="CPU and memory cannot be read because VictoriaMetrics is not reachable in the cluster. Instance statuses stay live."
        />
      ) : null}

      <WorkloadInstancesList
        instances={data?.instances ?? null}
        metricsAvailable={data?.metrics_available ?? true}
        isLive={isLive}
        activeVersionId={workload.active_version?.id ?? null}
        emptyHint={emptyHintFor(workload)}
        onOpenTerminal={handleOpenTerminal}
        canOpenTerminal={canOpen}
      />
    </DetailStack>
  );
};
