import { FolderOpen, LayoutDashboard, SlidersHorizontal } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import { S3BucketOverview } from '@/modules/workloads/components/workload-details/s3-bucket-overview';
import { WorkloadIdentitySection } from '@/modules/workloads/components/workload-details/workload-common-sections';
import { BucketIcon } from '@/shared/icons/bucket-icon';
import { S3BucketAccessKeysSection } from '../s3-bucket-access-keys';
import { S3BucketExplorer } from '../s3-bucket-explorer';
import { WorkloadDeleteSection } from '../workload-actions';
import type { WorkloadDetailView } from './workload-detail-view';

/**
 * An S3 bucket has no lifecycle to drive: it exists from creation until it is
 * deleted, so the header carries no actions and there are no versions.
 */
export const getS3BucketDetailView = (
  workload: Workload,
): WorkloadDetailView => ({
  kindLabel: 'S3 bucket',
  icon: <BucketIcon className="size-5" />,
  tabs: [
    {
      id: 'overview',
      label: 'Overview',
      icon: LayoutDashboard,
      content: <S3BucketOverview workload={workload} />,
    },
    {
      id: 'explore',
      label: 'Explore',
      icon: FolderOpen,
      content: <S3BucketExplorer workload={workload} />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: SlidersHorizontal,
      content: (
        <DetailStack>
          <S3BucketAccessKeysSection workload={workload} />
          <WorkloadIdentitySection workload={workload} />
          <WorkloadDeleteSection consequence="Deletes the bucket, every object in it and its access keys." />
        </DetailStack>
      ),
    },
  ],
  headerActions: null,
});
