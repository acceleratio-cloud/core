'use client';

import { useEffect, useState } from 'react';
import type {
  ClusterCapacityOverview,
  ClusterResourceCapacity,
} from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { clusterApi } from '@/api/cluster';
import { GaugePanel } from '@/modules/observability/components/gauge-panel';
import {
  formatBytes,
  formatCores,
  type ValueFormatter,
} from '@/modules/observability/utils/format';

/** Used share and caption for one resource; unknown parts read as such. */
const gauge = (
  { total, available }: ClusterResourceCapacity,
  format: ValueFormatter,
  missing: string,
) => {
  if (total === null) {
    return { ratio: null, caption: 'Capacity not reported' };
  }

  if (available === null) {
    return { ratio: null, caption: `${format(total)} total, ${missing}` };
  }

  return {
    ratio: total > 0 ? (total - available) / total : null,
    caption: `${format(available)} available of ${format(total)}`,
  };
};

/** Total and available CPU, memory and storage of the whole cluster. */
export const CapacityOverview = ({ refreshKey }: { refreshKey: number }) => {
  const [capacity, setCapacity] = useState<ClusterCapacityOverview | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    clusterApi
      .capacity()
      .then((data) => {
        if (active) {
          setCapacity(data);
          setError(null);
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getApiErrorMessage(requestError));
        }
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  if (!capacity) {
    return (
      <p
        role="status"
        className={
          error ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
        }
      >
        {error ?? 'Loading capacity...'}
      </p>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-3">
      <GaugePanel
        title="CPU"
        reference="in use"
        {...gauge(capacity.cpu_cores, formatCores, 'usage not reported')}
      />
      <GaugePanel
        title="Memory"
        reference="in use"
        {...gauge(capacity.memory_bytes, formatBytes, 'usage not reported')}
      />
      <GaugePanel
        title="Storage"
        reference={
          capacity.storage_bytes.source === 'longhorn'
            ? 'Longhorn disks'
            : 'server disks'
        }
        {...gauge(
          capacity.storage_bytes,
          formatBytes,
          'free space needs Longhorn',
        )}
      />
    </div>
  );
};
