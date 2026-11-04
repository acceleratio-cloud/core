import { Box, Rocket } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import {
  CopyableProperty,
  DetailNotice,
  DetailSection,
  PropertyList,
  TimeProperty,
} from './detail-primitives';

/**
 * Sections every workload type shares. They read only the common `Workload`
 * fields, so a type view composes them next to its own sections.
 */

export const WorkloadFailureNotice = ({
  workload,
  title = 'Deployment failed',
}: {
  workload: Workload;
  title?: string;
}) => {
  if (workload.status !== 'failed' || !workload.status_message) {
    return null;
  }

  return <DetailNotice title={title} message={workload.status_message} />;
};

export const WorkloadDeploymentSection = ({
  workload,
}: {
  workload: Workload;
}) => (
  <DetailSection title="Deployment" icon={Rocket}>
    <PropertyList>
      <TimeProperty
        label="Last deployed"
        value={workload.last_deployed_at}
        emptyLabel="Never"
      />
      <TimeProperty
        label="Status checked"
        value={workload.status_observed_at}
      />
      <TimeProperty label="Last updated" value={workload.updated_at} />
      <TimeProperty label="Created" value={workload.created_at} />
    </PropertyList>
  </DetailSection>
);

export const WorkloadIdentitySection = ({
  workload,
}: {
  workload: Workload;
}) => (
  <DetailSection title="Cluster" icon={Box}>
    <PropertyList>
      <CopyableProperty label="Namespace" value={workload.namespace} />
      <CopyableProperty label="External name" value={workload.external_name} />
      <CopyableProperty label="Service ID" value={workload.id} />
    </PropertyList>
  </DetailSection>
);
