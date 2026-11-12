'use client';

import { useState } from 'react';
import { Database, Eye, EyeOff, KeyRound, PlugZap } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { Button } from '@/shared/components/ui/button';
import { CopyButton } from '@/shared/components/copy-button';
import {
  CopyableProperty,
  DetailSection,
  DetailStack,
  PropertyList,
  PropertyRow,
  TimeProperty,
} from './detail-primitives';
import { WorkloadFailureNotice } from './workload-common-sections';

/** Variables the keys Secret holds, in the order an SDK needs them. */
const SECRET_VARIABLES = [
  'AWS_ENDPOINT_URL',
  'AWS_REGION',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'S3_BUCKET',
];

const MASK = '•'.repeat(24);

/**
 * The secret key is not part of the workload; it is fetched only when the
 * user asks for it and dropped again when hidden.
 */
const SecretKeyProperty = ({ workload }: { workload: Workload }) => {
  const [secret, setSecret] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reveal = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const credentials = await workloadsApi.getCredentials(
        workload.project_id,
        workload.id,
      );

      setSecret(credentials.secret_access_key);
    } catch (revealError) {
      setError(getApiErrorMessage(revealError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-start gap-2 py-2.5 pr-2 pl-3">
      <div className="min-w-0 flex-1">
        <dt className="text-xs leading-5 text-fg-tertiary">
          Secret access key
        </dt>
        <dd className="mt-0.5 font-mono text-xs leading-5 break-all text-fg-primary">
          {secret ?? <span className="text-fg-tertiary">{MASK}</span>}
          {error ? (
            <span
              role="alert"
              className="mt-1 block font-sans text-destructive"
            >
              {error}
            </span>
          ) : null}
        </dd>
      </div>
      <div className="mt-1.5 flex shrink-0 items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={
            secret ? 'Hide secret access key' : 'Show secret access key'
          }
          loading={isLoading}
          onClick={() => (secret ? setSecret(null) : void reveal())}
          className="text-fg-tertiary"
        >
          {secret ? (
            <EyeOff
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5"
            />
          ) : (
            <Eye aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          )}
        </Button>
        {secret ? (
          <CopyButton
            value={secret}
            label="secret access key"
            className="text-fg-tertiary"
          />
        ) : null}
      </div>
    </div>
  );
};

/** Where the bucket is, the keys to it, and how a service picks them up. */
export const S3BucketOverview = ({ workload }: { workload: Workload }) => {
  const access = workload.s3 ?? null;

  return (
    <DetailStack>
      <WorkloadFailureNotice
        workload={workload}
        title="Bucket creation failed"
      />

      <DetailSection title="Access">
        {access ? (
          <PropertyList>
            <CopyableProperty label="Endpoint" value={access.endpoint} />
            <CopyableProperty label="Bucket" value={access.bucket} />
            <PropertyRow label="Region" mono>
              {access.region}
            </PropertyRow>
            <CopyableProperty
              label="Access key ID"
              value={access.access_key_id}
            />
            {/* Keyed by the access key: a revealed secret never outlives it. */}
            <SecretKeyProperty key={access.access_key_id} workload={workload} />
          </PropertyList>
        ) : (
          <p className="px-3 py-3 text-xs leading-relaxed text-fg-tertiary">
            {workload.status === 'deploying'
              ? 'Keys appear here once the bucket exists.'
              : 'The keys could not be read from the cluster.'}
          </p>
        )}
      </DetailSection>

      {access ? (
        <DetailSection title="Use from a service">
          <div className="px-3 py-3 text-xs leading-relaxed text-fg-secondary">
            <p>
              The Kubernetes Secret{' '}
              <code className="font-mono text-fg-primary">
                {access.secret_name}
              </code>{' '}
              in this project holds the keys under the names AWS SDKs read. The
              endpoint is reachable from services in this cluster only.
            </p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {SECRET_VARIABLES.map((name) => (
                <li
                  key={name}
                  className="rounded-sm border border-edge-default bg-surface-sunken px-1.5 font-mono leading-5 text-fg-secondary"
                >
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </DetailSection>
      ) : null}

      <DetailSection title="Storage">
        <PropertyList>
          <TimeProperty label="Created" value={workload.created_at} />
        </PropertyList>
      </DetailSection>
    </DetailStack>
  );
};
