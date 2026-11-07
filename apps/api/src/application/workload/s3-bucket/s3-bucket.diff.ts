import type { S3BucketConfig, WorkloadDiffSection } from '@acceleratio/shared';
import {
  changesOf,
  compareField,
} from '@/application/workload/workload-version.diff';

/**
 * The fields of two bucket configs that differ. A bucket has no pods, so no
 * change restarts anything. `profileName` turns a storage profile id into
 * the name people know it by.
 */
export const diffBucketConfigs = (
  base: S3BucketConfig | null,
  target: S3BucketConfig | null,
  profileName: (id: string) => string = (id) => id,
): WorkloadDiffSection[] => [
  {
    key: 'storage',
    label: 'Storage',
    changes: changesOf([
      compareField({
        path: 'storage_class_id',
        label: 'Storage profile',
        before: base && profileName(base.storage_class_id),
        after: target && profileName(target.storage_class_id),
      }),
    ]),
  },
];
