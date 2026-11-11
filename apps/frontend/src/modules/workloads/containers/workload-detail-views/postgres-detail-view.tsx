import {
  DatabaseBackup,
  LayoutDashboard,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import {
  PostgresData,
  PostgresOverview,
} from '@/modules/workloads/components/workload-details/postgres-overview';
import { WorkloadIdentitySection } from '@/modules/workloads/components/workload-details/workload-common-sections';
import {
  PostgresCredentialsSection,
  PostgresExternalAccessSection,
  PostgresResourcesSection,
} from '../postgres-access';
import { PostgresBackupsPanel } from '../postgres-backups';
import {
  WorkloadDeleteSection,
  WorkloadLifecycleActions,
} from '../workload-actions';
import { PostgresIcon } from '@/shared/icons/postgres-icon';
import type { WorkloadDetailView } from './workload-detail-view';

/**
 * A PostgreSQL database run by CloudNativePG: start, stop and restart, but
 * nothing to deploy; its settings apply when they are saved.
 */
export const getPostgresDetailView = (
  workload: Workload,
): WorkloadDetailView => ({
  kindLabel: 'PostgreSQL',
  icon: <PostgresIcon className="size-5" />,
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: <PostgresOverview workload={workload} />,
    },
    {
      id: 'data',
      label: 'Data',
      icon: Table2,
      content: <PostgresData workload={workload} />,
    },
    {
      id: 'backups',
      label: 'Backups',
      icon: DatabaseBackup,
      content: <PostgresBackupsPanel workload={workload} />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: SlidersHorizontal,
      content: (
        <DetailStack>
          <PostgresResourcesSection workload={workload} />
          <PostgresExternalAccessSection workload={workload} />
          <PostgresCredentialsSection workload={workload} />
          <WorkloadIdentitySection workload={workload} />
          <WorkloadDeleteSection consequence="Deletes the database, its volume and every row stored in it, its credentials and all of its backups." />
        </DetailStack>
      ),
    },
  ],
  headerActions: <WorkloadLifecycleActions />,
});
