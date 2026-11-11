'use client';

import type { Node, NodeProps } from '@xyflow/react';
import { Activity, Globe, LoaderCircle } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { WorkloadStatus } from '@/modules/workloads/components/workload-status';
import { bucketStatusLabel } from '@/modules/workloads/utils/s3-bucket';
import { BucketIcon } from '@/shared/icons/bucket-icon';
import { internalAddress } from '@/modules/workloads/utils/internal-hostname';
import {
  NodeCard,
  NodeHeader,
  NodeNotice,
  NodeRow,
  NodeRows,
} from './node-card-primitives';

export type S3BucketWorkloadNode = Node<
  Workload & Record<string, unknown>,
  's3_bucket'
>;

/** The endpoint without its scheme, which is all a card has room for. */
const endpointHost = (endpoint: string) => endpoint.replace(/^https?:\/\//, '');

export const S3BucketWorkloadCard = ({
  data,
  selected,
}: NodeProps<S3BucketWorkloadNode>) => (
  <NodeCard selected={selected}>
    <NodeHeader
      icon={<BucketIcon className="size-4" />}
      title={data.name}
      subtitle={internalAddress(data)}
      status={data.status}
    />

    <NodeRows>
      <NodeRow icon={Activity} label="Status">
        <WorkloadStatus
          status={data.status}
          label={bucketStatusLabel(data.status)}
          compact
          className="items-end"
        />
      </NodeRow>
      <NodeRow icon={Globe} label="Endpoint" title={data.s3?.endpoint}>
        {data.s3 ? endpointHost(data.s3.endpoint) : '—'}
      </NodeRow>
    </NodeRows>

    {data.status === 'failed' && data.status_message ? (
      <NodeNotice key={data.status_message}>{data.status_message}</NodeNotice>
    ) : null}

    {data.status === 'deploying' ? (
      <div className="flex h-9 items-center justify-center gap-1.5 border-t border-edge-subtle text-xs text-muted-foreground">
        <LoaderCircle
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 animate-spin motion-reduce:animate-none"
        />
        Creating bucket
      </div>
    ) : null}
  </NodeCard>
);
