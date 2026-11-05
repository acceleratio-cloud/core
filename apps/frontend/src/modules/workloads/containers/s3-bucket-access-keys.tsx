'use client';

import { useEffect, useRef, useState } from 'react';
import { KeyRound, RotateCw, TriangleAlert } from 'lucide-react';

import type { S3BucketCredentials, Workload } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { s3BucketObjectsApi } from '@/api/workloads/s3-bucket-objects';
import { useProject } from '@/modules/projects/providers/project-provider';
import { CopyButton } from '@/shared/components/copy-button';
import {
  CopyableProperty,
  DetailSection,
  PropertyList,
} from '@/modules/workloads/components/workload-details/detail-primitives';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';

/**
 * The bucket's access key and a way to replace both keys. Regeneration is
 * behind a confirmation because the old keys stop working at once and every
 * service using them loses access until it restarts with the new Secret.
 * The new secret key is shown once, right after, so it can be copied.
 */
export const S3BucketAccessKeysSection = ({
  workload,
}: {
  workload: Workload;
}) => {
  const { replaceWorkload } = useProject();
  const [isOpen, setIsOpen] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<S3BucketCredentials | null>(null);
  // The panel ignores pointer events; the dialog mounts on the body.
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  const access = workload.s3 ?? null;
  const ready = workload.status === 'running';

  const rotate = async () => {
    setIsRotating(true);
    setError(null);

    try {
      const credentials = await s3BucketObjectsApi.rotateCredentials(
        workload.project_id,
        workload.id,
      );

      setRotated(credentials);
      setIsOpen(false);
      // The card and the overview read the access key from the workload.
      replaceWorkload(await workloadsApi.get(workload.project_id, workload.id));
    } catch (rotateError) {
      setError(getApiErrorMessage(rotateError));
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <>
      <DetailSection title="Access keys">
        {access ? (
          <PropertyList>
            <CopyableProperty
              label="Access key ID"
              value={access.access_key_id}
            />
            {rotated ? (
              <div className="bg-status-success/5 py-2.5 pr-2 pl-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs leading-5 text-fg-tertiary">
                      New secret access key
                    </p>
                    <p className="mt-0.5 font-mono text-xs leading-5 break-all text-fg-primary">
                      {rotated.secret_access_key}
                    </p>
                  </div>
                  <CopyButton
                    value={rotated.secret_access_key}
                    label="new secret access key"
                    className="mt-2.5 text-fg-tertiary"
                  />
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-fg-secondary">
                  Saved to the Secret{' '}
                  <code className="font-mono">{rotated.secret_name}</code>.
                  Restart the services that use it so they pick up the new keys.
                </p>
              </div>
            ) : null}
          </PropertyList>
        ) : null}

        <div className={access ? 'border-t border-edge-subtle' : undefined}>
          <div className="flex items-center gap-4 px-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-fg-primary">
                Regenerate keys
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-fg-tertiary">
                Replaces the access key and secret key. The current keys stop
                working immediately.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!ready || isRotating}
              onClick={() => {
                setError(null);
                setIsOpen(true);
              }}
              className="shrink-0"
            >
              <RotateCw
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              Regenerate
            </Button>
          </div>
          {!ready ? (
            <p className="border-t border-edge-subtle px-3 py-2.5 text-xs text-fg-tertiary">
              Keys can be regenerated once the bucket is ready.
            </p>
          ) : null}
        </div>
      </DetailSection>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!isRotating) {
            setIsOpen(open);
          }
        }}
      >
        <DialogContent container={bodyRef} showCloseButton={!isRotating}>
          <DialogHeader>
            <DialogTitle>Regenerate access keys</DialogTitle>
            <DialogDescription>
              New keys for {workload.name}. The current access key
              {access ? (
                <>
                  {' '}
                  <code className="font-mono">{access.access_key_id}</code>
                </>
              ) : null}{' '}
              and its secret key stop working as soon as SeaweedFS applies the
              change.
            </DialogDescription>
          </DialogHeader>

          <div className="flex mt-4 gap-2.5 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2.5 text-xs leading-relaxed text-fg-secondary">
            <TriangleAlert
              aria-hidden="true"
              strokeWidth={1.75}
              className="mt-0.5 size-3.5 shrink-0 text-status-warning"
            />
            <p>
              Services that read the keys from the Secret
              {access ? (
                <>
                  {' '}
                  <code className="font-mono">{access.secret_name}</code>
                </>
              ) : null}{' '}
              keep the old ones until they restart, and lose access to the
              bucket until then. Tools configured by hand need the new keys too.
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="text-xs leading-relaxed text-destructive"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={isRotating}
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={isRotating}
              onClick={() => void rotate()}
            >
              <RotateCw
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
              {isRotating ? 'Regenerating' : 'Regenerate keys'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
