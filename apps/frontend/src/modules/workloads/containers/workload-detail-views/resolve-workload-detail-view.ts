import type { Workload } from '@acceleratio/shared';
import { getDockerDetailView } from './docker-detail-view';
import { getGithubDetailView } from './github-detail-view';
import { getGenericDetailView } from './generic-detail-view';
import { getS3BucketDetailView } from './s3-bucket-detail-view';
import type { WorkloadDetailView } from './workload-detail-view';

/**
 * The single place that maps a workload type to its inspector view.
 *
 * Adding a type: create `<type>-detail-view.tsx` next to this file and add a
 * `case` below. The `satisfies never` check in `default` stops compiling as
 * soon as `WorkloadType` gains a member without a case.
 */
export const resolveWorkloadDetailView = (
  workload: Workload,
): WorkloadDetailView => {
  switch (workload.type) {
    case 'docker':
      return getDockerDetailView(workload);
    case 's3_bucket':
      return getS3BucketDetailView(workload);
    case 'github':
      return getGithubDetailView(workload);
    default:
      workload.type satisfies never;
      return getGenericDetailView(workload);
  }
};
