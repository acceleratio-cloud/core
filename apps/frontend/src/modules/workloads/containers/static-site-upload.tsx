'use client';

import { useRef, useState } from 'react';
import { FolderUp, Upload } from 'lucide-react';

import type { StaticWorkloadConfig } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { staticReleasesApi } from '@/api/workloads/static-releases';
import { DetailSection } from '@/modules/workloads/components/workload-details/detail-primitives';
import { useProject } from '@/modules/projects/providers/project-provider';
import { sendAll, sitePath } from '@/modules/workloads/utils/static-site';
import { Button } from '@/shared/components/ui/button';
import { useWorkloadActions } from './workload-actions';

/** Files sent at once; more only queue in the browser anyway. */
const PARALLEL_UPLOADS = 4;

type Phase =
  | { kind: 'idle' }
  | { kind: 'uploading'; loaded: number; total: number }
  | { kind: 'deploying' }
  | { kind: 'failed'; message: string };

/**
 * Uploads a whole site as a new release, publishes it and deploys it. The
 * running site keeps serving its files until the new pods are ready.
 */
export const StaticSiteUpload = () => {
  const { workload, pendingAction, runLifecycle } = useWorkloadActions();
  const { replaceWorkload } = useProject();
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const busy =
    phase.kind === 'uploading' ||
    phase.kind === 'deploying' ||
    pendingAction !== null;
  const live = (
    workload.active_version?.config as StaticWorkloadConfig | undefined
  )?.release_id;

  const publish = async (files: File[]) => {
    if (!files.some((file) => sitePath(file) === 'index.html')) {
      setPhase({
        kind: 'failed',
        message:
          'Pick the folder that has index.html at its top level, such as dist or build.',
      });
      return;
    }

    const total = files.reduce((sum, file) => sum + file.size, 0);
    const loaded = new Map<File, number>();
    // One failed file stops the rest: the upload is abandoned, not retried.
    const abort = new AbortController();
    const report = () => {
      if (!abort.signal.aborted) {
        setPhase({
          kind: 'uploading',
          total,
          loaded: [...loaded.values()].reduce((sum, bytes) => sum + bytes, 0),
        });
      }
    };

    try {
      report();
      const { project_id: projectId, id } = workload;
      const release = await staticReleasesApi.create(projectId, id);

      await sendAll(
        files,
        async (file, signal) => {
          await staticReleasesApi.uploadFile(
            projectId,
            id,
            release.id,
            sitePath(file),
            file,
            {
              signal,
              onProgress: (bytes) => {
                loaded.set(file, bytes);
                report();
              },
            },
          );
          loaded.set(file, file.size);
          report();
        },
        PARALLEL_UPLOADS,
        abort,
      );

      setPhase({ kind: 'deploying' });
      // The API keeps the settings the site has at this moment.
      replaceWorkload(
        await staticReleasesApi.publish(projectId, id, release.id),
      );
      setPhase(
        (await runLifecycle('deploy'))
          ? { kind: 'idle' }
          : {
              kind: 'failed',
              message: 'The files are uploaded but the deploy failed.',
            },
      );
    } catch (error) {
      setPhase({ kind: 'failed', message: getApiErrorMessage(error) });
    }
  };

  const pick = (list: FileList | null) => {
    const files = list ? [...list] : [];

    if (files.length > 0) {
      void publish(files);
    }
  };

  const percent =
    phase.kind === 'uploading' && phase.total > 0
      ? Math.round((phase.loaded / phase.total) * 100)
      : 0;

  return (
    <DetailSection
      title="Files"
      description={
        live
          ? 'Uploading replaces every file of the site and deploys it. Roll back from Versions to serve an earlier upload.'
          : 'Upload the built site: the folder with index.html at its top level. A 404.html there answers for missing pages.'
      }
      action={
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => filesInputRef.current?.click()}
          >
            <Upload
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Files
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => folderInputRef.current?.click()}
          >
            <FolderUp
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            Upload folder
          </Button>
          <input
            ref={folderInputRef}
            type="file"
            hidden
            // Not in React's types; browsers then pick a whole folder.
            {...({ webkitdirectory: '' } as object)}
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            ref={filesInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              pick(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      }
    >
      <div
        aria-live="polite"
        className="rounded-lg border border-edge-default bg-surface-raised px-3 py-2.5 text-xs text-fg-secondary"
      >
        {phase.kind === 'uploading' ? (
          <>
            <div className="flex justify-between tabular-nums">
              <span>Uploading</span>
              <span>{percent}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Uploading the site"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-muted"
            >
              <div
                className="h-full rounded-full bg-brand transition-[width] duration-150 motion-reduce:transition-none"
                style={{ width: `${percent}%` }}
              />
            </div>
          </>
        ) : phase.kind === 'deploying' ? (
          'Deploying the upload…'
        ) : phase.kind === 'failed' ? (
          <span role="alert" className="text-destructive">
            {phase.message}
          </span>
        ) : live ? (
          `Serving the upload of v${workload.active_version?.number}.`
        ) : (
          'Nothing uploaded yet.'
        )}
      </div>
    </DetailSection>
  );
};
