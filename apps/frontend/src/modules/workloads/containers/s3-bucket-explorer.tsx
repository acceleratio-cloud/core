'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  ChevronRight,
  CircleAlert,
  Download,
  File as FileIcon,
  Folder,
  FolderPlus,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

import type {
  S3BucketEntry,
  S3BucketListing,
  Workload,
} from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { s3BucketObjectsApi } from '@/api/workloads/s3-bucket-objects';
import { cn } from '@/lib/utils';
import {
  formatAbsoluteTime,
  formatRelativeTime,
} from '@/modules/workloads/utils/format-time';
import {
  formatBytes,
  objectNameProblem,
  prefixTrail,
} from '@/modules/workloads/utils/s3-bucket';
import { Button, buttonVariants } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

type ListingState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; listing: S3BucketListing };

interface UploadItem {
  id: string;
  name: string;
  /** The folder it goes to, so finished uploads refresh only that folder. */
  prefix: string;
  size: number;
  loaded: number;
  status: 'uploading' | 'done' | 'failed';
  error?: string;
  controller: AbortController;
}

/**
 * The inspector panel ignores pointer events and a dialog inside it would
 * inherit that, so confirmations mount on the body.
 */
const useBodyContainer = () => {
  const bodyRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    bodyRef.current = document.body;
  }, []);

  return bodyRef;
};

const Breadcrumbs = ({
  bucket,
  prefix,
  onNavigate,
}: {
  bucket: string;
  prefix: string;
  onNavigate: (prefix: string) => void;
}) => {
  const trail = prefixTrail(prefix);

  return (
    <nav aria-label="Folder path" className="min-w-0 flex-1">
      <ol className="flex min-w-0 items-center gap-0.5 text-sm">
        <li className="flex min-w-0 shrink-0 items-center">
          <button
            type="button"
            onClick={() => onNavigate('')}
            aria-current={trail.length === 0 ? 'page' : undefined}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-1.5 font-mono text-xs outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring',
              trail.length === 0
                ? 'font-medium text-fg-primary'
                : 'text-fg-secondary',
            )}
          >
            <HardDrive
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 text-fg-tertiary"
            />
            {bucket}
          </button>
        </li>
        {trail.map((crumb, index) => {
          const current = index === trail.length - 1;

          return (
            <li key={crumb.prefix} className="flex min-w-0 items-center">
              <ChevronRight
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 shrink-0 text-fg-disabled"
              />
              <button
                type="button"
                onClick={() => onNavigate(crumb.prefix)}
                aria-current={current ? 'page' : undefined}
                title={crumb.name}
                className={cn(
                  'h-7 max-w-40 truncate rounded-md px-1.5 text-xs outline-none hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-ring',
                  current ? 'font-medium text-fg-primary' : 'text-fg-secondary',
                )}
              >
                {crumb.name}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
};

const NewFolderRow = ({
  existing,
  onCreate,
  onCancel,
}: {
  existing: Set<string>;
  onCreate: (name: string) => Promise<void>;
  onCancel: () => void;
}) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event: { preventDefault(): void }) => {
    event.preventDefault();
    const problem =
      objectNameProblem(name) ??
      (existing.has(name.trim()) ? 'Something with this name is here.' : null);

    if (problem) {
      setError(problem);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onCreate(name.trim());
    } catch (createError) {
      setError(getApiErrorMessage(createError));
      setIsSaving(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="border-b border-edge-subtle px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <Folder
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-4 shrink-0 text-fg-tertiary"
        />
        <Input
          autoFocus
          aria-label="New folder name"
          aria-invalid={error ? true : undefined}
          placeholder="Folder name"
          value={name}
          disabled={isSaving}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onCancel();
            }
          }}
          className="h-8 flex-1"
        />
        <Button type="submit" size="sm" loading={isSaving}>
          Create
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isSaving}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 pl-6 text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  );
};

const UploadList = ({
  uploads,
  onDismiss,
}: {
  uploads: UploadItem[];
  onDismiss: (id: string) => void;
}) => {
  if (uploads.length === 0) {
    return null;
  }

  return (
    <ul
      aria-label="Uploads"
      className="overflow-hidden rounded-lg border border-edge-default bg-surface-raised divide-y divide-edge-subtle"
    >
      {uploads.map((upload) => {
        const percent =
          upload.size === 0
            ? 100
            : Math.min(100, Math.round((upload.loaded / upload.size) * 100));

        return (
          <li key={upload.id} className="flex items-center gap-3 px-3 py-2">
            {upload.status === 'uploading' ? (
              <LoaderCircle
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 shrink-0 animate-spin text-fg-tertiary motion-reduce:animate-none"
              />
            ) : upload.status === 'failed' ? (
              <CircleAlert
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 shrink-0 text-status-danger"
              />
            ) : (
              <Upload
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5 shrink-0 text-status-success"
              />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-fg-primary" title={upload.name}>
                  {upload.name}
                </span>
                <span className="shrink-0 text-fg-tertiary tabular-nums">
                  {upload.status === 'failed'
                    ? 'Failed'
                    : upload.status === 'done'
                      ? formatBytes(upload.size)
                      : `${percent}%`}
                </span>
              </div>
              {upload.status === 'uploading' ? (
                <div
                  role="progressbar"
                  aria-label={`Uploading ${upload.name}`}
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
              ) : null}
              {upload.error ? (
                <p className="mt-0.5 text-xs text-destructive">
                  {upload.error}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={
                upload.status === 'uploading'
                  ? `Cancel upload of ${upload.name}`
                  : `Dismiss ${upload.name}`
              }
              onClick={() => onDismiss(upload.id)}
              className="text-fg-tertiary"
            >
              <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
            </Button>
          </li>
        );
      })}
    </ul>
  );
};

const DeleteEntryDialog = ({
  entry,
  onConfirm,
  onClose,
}: {
  entry: S3BucketEntry | null;
  onConfirm: (entry: S3BucketEntry) => Promise<void>;
  onClose: () => void;
}) => {
  const bodyRef = useBodyContainer();
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setError(null);
    onClose();
  };

  const confirm = async () => {
    if (!entry) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    try {
      await onConfirm(entry);
      close();
    } catch (deleteError) {
      setError(getApiErrorMessage(deleteError));
    } finally {
      setIsDeleting(false);
    }
  };

  const isFolder = entry?.kind === 'folder';

  return (
    <Dialog
      open={entry !== null}
      onOpenChange={(open) => {
        if (!open && !isDeleting) {
          close();
        }
      }}
    >
      <DialogContent container={bodyRef} showCloseButton={!isDeleting}>
        <DialogHeader>
          <DialogTitle>
            {isFolder ? 'Delete folder' : 'Delete file'}
          </DialogTitle>
          <DialogDescription>
            {isFolder
              ? `Delete ${entry?.name} and everything in it? This cannot be undone.`
              : `Delete ${entry?.name}? This cannot be undone.`}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={isDeleting}
            onClick={close}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={isDeleting}
            onClick={() => void confirm()}
          >
            <Trash2
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            {isDeleting ? 'Deleting' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const EntryRow = ({
  entry,
  downloadUrl,
  onOpen,
  onDelete,
}: {
  entry: S3BucketEntry;
  downloadUrl: string | null;
  onOpen: (prefix: string) => void;
  onDelete: (entry: S3BucketEntry) => void;
}) => {
  const isFolder = entry.kind === 'folder';
  const Icon = isFolder ? Folder : FileIcon;

  return (
    <tr className="group/row border-b border-edge-subtle last:border-b-0 hover:bg-surface-muted/50">
      <td className="max-w-0 py-0 pr-2 pl-3">
        {isFolder ? (
          <button
            type="button"
            onClick={() => onOpen(entry.path)}
            className="flex h-9 w-full min-w-0 items-center gap-2 text-left text-sm text-fg-primary outline-none focus-visible:underline"
          >
            <Icon
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 shrink-0 fill-brand/10 text-brand-fg"
            />
            <span className="truncate" title={entry.name}>
              {entry.name}
            </span>
          </button>
        ) : (
          <span className="flex h-9 min-w-0 items-center gap-2 text-sm text-fg-primary">
            <Icon
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-4 shrink-0 text-fg-tertiary"
            />
            <span className="truncate" title={entry.name}>
              {entry.name}
            </span>
          </span>
        )}
      </td>
      <td className="w-24 px-2 text-right text-xs whitespace-nowrap text-fg-secondary tabular-nums">
        {entry.size === null ? '—' : formatBytes(entry.size)}
      </td>
      <td className="w-32 px-2 text-xs whitespace-nowrap text-fg-tertiary tabular-nums">
        {entry.modified_at ? (
          <time
            dateTime={entry.modified_at}
            title={formatAbsoluteTime(entry.modified_at)}
          >
            {formatRelativeTime(entry.modified_at)}
          </time>
        ) : (
          '—'
        )}
      </td>
      <td className="w-20 pr-2 pl-1">
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 motion-reduce:transition-none">
          {downloadUrl ? (
            // A link, so the browser streams the file to disk itself.
            <a
              href={downloadUrl}
              download={entry.name}
              aria-label={`Download ${entry.name}`}
              className={cn(
                buttonVariants({ variant: 'ghost', size: 'icon-xs' }),
                'text-fg-tertiary',
              )}
            >
              <Download
                aria-hidden="true"
                strokeWidth={1.75}
                className="size-3.5"
              />
            </a>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Delete ${entry.name}`}
            onClick={() => onDelete(entry)}
            className="text-fg-tertiary hover:text-destructive"
          >
            <Trash2
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5"
            />
          </Button>
        </div>
      </td>
    </tr>
  );
};

/**
 * Folders and files of one S3 bucket. Folders are prefixes: opening one
 * lists the keys under it, and a new folder is an empty prefix that S3
 * clients see as well. Files upload straight from the browser, by button or
 * by dropping them on the list.
 */
export const S3BucketExplorer = ({ workload }: { workload: Workload }) => {
  const bucket = workload.external_name;
  const [prefix, setPrefix] = useState('');
  const [state, setState] = useState<ListingState>({ status: 'loading' });
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [pendingDelete, setPendingDelete] = useState<S3BucketEntry | null>(
    null,
  );
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const prefixRef = useRef(prefix);
  const activeUploads = useRef(new Set<AbortController>());
  const ready = workload.status === 'running';

  useEffect(() => {
    prefixRef.current = prefix;
  }, [prefix]);

  /**
   * Fetches one folder and shows it; the previous listing stays until the
   * answer arrives. Only the latest request may write, so a slow answer for
   * a folder the user already left is dropped.
   */
  const fetchListing = useCallback(
    (target: string): Promise<void> => {
      const request = (requestRef.current += 1);

      return s3BucketObjectsApi
        .list(workload.project_id, workload.id, target)
        .then(
          (listing) => {
            if (request === requestRef.current) {
              setState({ status: 'ready', listing });
            }
          },
          (error: unknown) => {
            if (request === requestRef.current) {
              setState({ status: 'error', message: getApiErrorMessage(error) });
            }
          },
        );
    },
    [workload.id, workload.project_id],
  );

  useEffect(() => {
    if (ready) {
      void fetchListing(prefix);
    }
  }, [fetchListing, prefix, ready]);

  /** For explicit reloads: shows the loading state first. */
  const reload = (target: string) => {
    setState({ status: 'loading' });
    void fetchListing(target);
  };

  // Cancel uploads still running when the panel closes.
  useEffect(() => {
    const running = activeUploads.current;

    return () => {
      running.forEach((controller) => controller.abort());
      running.clear();
    };
  }, []);

  const navigate = (next: string) => {
    setIsCreatingFolder(false);

    if (next !== prefix) {
      setState({ status: 'loading' });
      setPrefix(next);
    }
  };

  const updateUpload = (id: string, patch: Partial<UploadItem>) =>
    setUploads((current) =>
      current.map((upload) =>
        upload.id === id ? { ...upload, ...patch } : upload,
      ),
    );

  const startUploads = (files: FileList | File[]) => {
    const target = prefixRef.current;

    for (const file of Array.from(files)) {
      const problem = objectNameProblem(file.name);
      const id = crypto.randomUUID();
      const controller = new AbortController();
      const item: UploadItem = {
        id,
        name: file.name,
        prefix: target,
        size: file.size,
        loaded: 0,
        status: problem ? 'failed' : 'uploading',
        error: problem ?? undefined,
        controller,
      };

      setUploads((current) => [...current, item]);

      if (problem) {
        continue;
      }

      activeUploads.current.add(controller);

      s3BucketObjectsApi
        .upload(
          workload.project_id,
          workload.id,
          `${target}${file.name}`,
          file,
          {
            signal: controller.signal,
            onProgress: (loaded) => updateUpload(id, { loaded }),
          },
        )
        .then(() => {
          updateUpload(id, { status: 'done', loaded: file.size });

          if (prefixRef.current === target) {
            void fetchListing(target);
          }

          // Finished uploads leave the list on their own.
          window.setTimeout(
            () =>
              setUploads((current) =>
                current.filter(
                  (upload) => upload.id !== id || upload.status !== 'done',
                ),
              ),
            4000,
          );
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) {
            return;
          }

          updateUpload(id, {
            status: 'failed',
            error: getApiErrorMessage(error),
          });
        })
        .finally(() => activeUploads.current.delete(controller));
    }
  };

  const dismissUpload = (id: string) =>
    setUploads((current) =>
      current.filter((upload) => {
        if (upload.id === id) {
          upload.controller.abort();
          return false;
        }

        return true;
      }),
    );

  const createFolder = async (name: string) => {
    await s3BucketObjectsApi.createFolder(
      workload.project_id,
      workload.id,
      `${prefix}${name}`,
    );
    setIsCreatingFolder(false);
    await fetchListing(prefix);
  };

  const deleteEntry = async (entry: S3BucketEntry) => {
    await s3BucketObjectsApi.remove(
      workload.project_id,
      workload.id,
      entry.path,
      entry.kind,
    );
    await fetchListing(prefix);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);

    if (event.dataTransfer.files.length > 0) {
      startUploads(event.dataTransfer.files);
    }
  };

  if (!ready) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <HardDrive
          aria-hidden="true"
          strokeWidth={1.5}
          className="size-6 text-fg-tertiary"
        />
        <p className="text-sm text-fg-secondary">
          {workload.status === 'deploying'
            ? 'The bucket is being created.'
            : 'The bucket is not available.'}
        </p>
        <p className="text-xs text-fg-tertiary">
          Its contents show here once it is ready.
        </p>
      </div>
    );
  }

  const entries = state.status === 'ready' ? state.listing.entries : [];
  const names = new Set(entries.map((entry) => entry.name));

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Breadcrumbs bucket={bucket} prefix={prefix} onNavigate={navigate} />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Refresh"
          onClick={() => reload(prefix)}
          className="text-fg-tertiary"
        >
          <RefreshCw
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-3.5"
          />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isCreatingFolder}
          onClick={() => setIsCreatingFolder(true)}
        >
          <FolderPlus
            data-icon="inline-start"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          New folder
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload
            data-icon="inline-start"
            aria-hidden="true"
            strokeWidth={1.75}
          />
          Upload
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (event.target.files) {
              startUploads(event.target.files);
            }

            event.target.value = '';
          }}
        />
      </div>

      <UploadList uploads={uploads} onDismiss={dismissUpload} />

      <div
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            setIsDragging(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setIsDragging(false);
          }
        }}
        onDrop={onDrop}
        className={cn(
          'relative flex min-h-48 flex-1 flex-col overflow-hidden rounded-lg border bg-surface-raised',
          isDragging
            ? 'border-dashed border-brand bg-brand-wash'
            : 'border-edge-default',
        )}
      >
        {isCreatingFolder ? (
          <NewFolderRow
            existing={names}
            onCreate={createFolder}
            onCancel={() => setIsCreatingFolder(false)}
          />
        ) : null}

        {state.status === 'loading' ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-xs text-fg-tertiary">
            <LoaderCircle
              aria-hidden="true"
              strokeWidth={1.75}
              className="size-3.5 animate-spin motion-reduce:animate-none"
            />
            Loading
          </div>
        ) : state.status === 'error' ? (
          <div
            role="alert"
            className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center"
          >
            <p className="text-sm text-fg-secondary">{state.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => (prefix ? navigate('') : reload(''))}
            >
              {prefix ? 'Back to the bucket root' : 'Try again'}
            </Button>
          </div>
        ) : entries.length === 0 && !isCreatingFolder ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-6 text-center">
            <Upload
              aria-hidden="true"
              strokeWidth={1.5}
              className="size-5 text-fg-tertiary"
            />
            <p className="text-sm text-fg-secondary">
              {prefix ? 'This folder is empty.' : 'This bucket is empty.'}
            </p>
            <p className="text-xs text-fg-tertiary">
              Drop files here or use Upload.
            </p>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <table className="w-full table-fixed border-collapse">
              <caption className="sr-only">
                Contents of {prefix ? prefix : `bucket ${bucket}`}
              </caption>
              <thead className="sticky top-0 z-[1] bg-surface-raised">
                <tr className="border-b border-edge-subtle text-left text-xs font-medium text-fg-tertiary">
                  <th scope="col" className="py-2 pr-2 pl-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="w-24 px-2 text-right font-medium">
                    Size
                  </th>
                  <th scope="col" className="w-32 px-2 font-medium">
                    Modified
                  </th>
                  <th scope="col" className="w-20 pr-2">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <EntryRow
                    key={entry.path}
                    entry={entry}
                    downloadUrl={
                      entry.kind === 'file'
                        ? s3BucketObjectsApi.downloadUrl(
                            workload.project_id,
                            workload.id,
                            entry.path,
                          )
                        : null
                    }
                    onOpen={navigate}
                    onDelete={setPendingDelete}
                  />
                ))}
              </tbody>
            </table>
            {state.status === 'ready' && state.listing.truncated ? (
              <p className="border-t border-edge-subtle px-3 py-2 text-xs text-fg-tertiary">
                Showing the first {entries.length} entries of this folder.
              </p>
            ) : null}
          </div>
        )}

        {isDragging ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <p className="rounded-md bg-surface-raised px-3 py-1.5 text-sm font-medium text-fg-primary shadow-float">
              Drop to upload to {prefix || bucket}
            </p>
          </div>
        ) : null}
      </div>

      <DeleteEntryDialog
        entry={pendingDelete}
        onConfirm={deleteEntry}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
};
