'use client';

import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CircleCheck,
  CircleX,
  Loader2,
  RotateCw,
  Upload,
} from 'lucide-react';
import { sileo } from 'sileo';

import type { ImportedService } from '@acceleratio/shared';
import { getApiErrorMessage } from '@/api';
import { workloadsApi } from '@/api/workloads';
import { workloadDomainsApi } from '@/api/workloads/domains';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import { Button } from '@/shared/components/ui/button';
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Textarea } from '@/shared/components/ui/textarea';
import {
  importService,
  type ImportApi,
  type ImportProgress,
} from '../utils/import-service';

/** Bytes; the API's limit, checked before a dropped file is read. */
const COMPOSE_MAX_BYTES = 512 * 1024;

const IMPORT_API: ImportApi = {
  list: workloadsApi.list,
  create: workloadsApi.create,
  deploy: workloadsApi.deploy,
  domains: workloadDomainsApi.list,
  generate: workloadDomainsApi.generate,
};

type RowStatus = 'loading' | 'success' | 'failed';

type Row = {
  name: string;
  status: RowStatus;
  /** The private address on success, the reason on failure. */
  detail?: string;
  url?: string;
  ignored: string[];
  /** Absent for a skipped service: there is nothing to retry. */
  service?: ImportedService;
};

const STATUS_LABEL: Record<RowStatus, string> = {
  loading: 'Importing',
  success: 'Imported',
  failed: 'Failed',
};

export const ImportComposeForm = ({
  projectId,
  onDone,
  onBack,
}: {
  projectId: string;
  onDone: () => void;
  onBack: () => void;
}) => {
  const {
    workloads,
    addWorkload,
    replaceWorkload,
    refreshWorkloads,
    focusWorkloads,
  } = useProject();
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progress = useRef<ImportProgress[]>([]);
  /** Services that were there before; a row never claims one of them. */
  const known = useRef(new Set<string>());
  /** False once the dialog closes; failures after that go to a toast. */
  const open = useRef(true);

  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  const readFile = async (file: File) => {
    if (file.size > COMPOSE_MAX_BYTES) {
      setError(
        `The compose file must be at most ${COMPOSE_MAX_BYTES / 1024} KiB.`,
      );
      return;
    }
    setContent(await file.text());
    setError(null);
  };

  const run = async (index: number, service: ImportedService) => {
    const update = (patch: Partial<Row>) =>
      setRows(
        (current) =>
          current?.map((row, at) =>
            at === index ? { ...row, ...patch } : row,
          ) ?? null,
      );
    const done = (progress.current[index] ??= {});
    update({ status: 'loading', detail: undefined });

    try {
      const url = await importService({
        api: IMPORT_API,
        projectId,
        service,
        progress: done,
        known: known.current,
        // The list reload and the camera wait for the whole batch.
        onCreated: (workload) => addWorkload(workload, { batch: true }),
        onDeployed: replaceWorkload,
      });
      update({
        status: 'success',
        detail: done.workload?.internal_domain ?? undefined,
        url,
      });
    } catch (runError) {
      const message = getApiErrorMessage(runError);
      update({ status: 'failed', detail: message });

      if (!open.current) {
        sileo.error({
          title: `${service.name} was not imported`,
          description: message,
        });
      }
    }
  };

  /** After a batch or a retry: one list reload, and every imported service in view. */
  const finish = () => {
    void refreshWorkloads();
    focusWorkloads(
      progress.current.flatMap((done) =>
        done.workload ? [done.workload.id] : [],
      ),
    );
  };

  const apply = async () => {
    if (!content.trim()) {
      setError('Paste a compose file or drop one here.');
      return;
    }

    setError(null);
    setApplying(true);

    try {
      const plan = await workloadsApi.importCompose(projectId, content);
      known.current = new Set(workloads.map(({ id }) => id));
      setRows([
        ...plan.services.map((service): Row => ({
          name: service.name,
          status: 'loading',
          ignored: service.ignored,
          service,
        })),
        ...plan.skipped.map(({ name, reason }): Row => ({
          name,
          status: 'failed',
          detail: reason,
          ignored: [],
        })),
      ]);
      void Promise.all(
        plan.services.map((service, index) => run(index, service)),
      ).then(finish);
    } catch (applyError) {
      setError(getApiErrorMessage(applyError));
    } finally {
      setApplying(false);
    }
  };

  if (rows) {
    const finished = rows.filter(({ status }) => status !== 'loading').length;

    return (
      <>
        <DialogHeader>
          <DialogTitle>Importing services</DialogTitle>
          <DialogDescription>
            {finished} of {rows.length} finished
          </DialogDescription>
        </DialogHeader>

        <div
          role="progressbar"
          aria-label="Import progress"
          aria-valuemin={0}
          aria-valuemax={rows.length}
          aria-valuenow={finished}
          className="mt-5 h-1 shrink-0 overflow-hidden rounded-full bg-surface-muted"
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-150 motion-reduce:transition-none"
            style={{ width: `${(finished / rows.length) * 100}%` }}
          />
        </div>

        <ul
          aria-live="polite"
          className="mt-4 -mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1 pb-1"
        >
          {rows.map((row, index) => (
            <li
              key={`${index}-${row.name}`}
              className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5"
            >
              <StatusIcon status={row.status} />

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm leading-5 font-medium text-foreground">
                  {row.name}
                  <span className="sr-only">: {STATUS_LABEL[row.status]}</span>
                </p>
                {row.url ? (
                  <a
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate font-mono text-xs text-fg-secondary underline-offset-2 hover:underline"
                  >
                    {row.url}
                  </a>
                ) : null}
                {row.detail ? (
                  <p
                    className={cn(
                      'text-xs break-words',
                      row.status === 'failed'
                        ? 'text-status-danger'
                        : 'font-mono text-fg-secondary',
                    )}
                  >
                    {row.detail}
                  </p>
                ) : null}
                {row.ignored.length > 0 ? (
                  <p className="mt-1 text-xs break-words text-muted-foreground">
                    Not imported: {row.ignored.join(', ')}
                  </p>
                ) : null}
              </div>

              {row.status === 'failed' && row.service ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void run(index, row.service!).then(finish)}
                >
                  <RotateCw data-icon="inline-start" aria-hidden="true" />
                  Retry
                  <span className="sr-only"> {row.name}</span>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import from Docker Compose</DialogTitle>
        <DialogDescription>
          Each service with an image becomes a Docker service in this project.
        </DialogDescription>
      </DialogHeader>

      <Field className="mt-5 min-h-0" data-invalid={error ? true : undefined}>
        <FieldLabel htmlFor="compose-file">Compose file</FieldLabel>
        <div
          onDragOver={(event) => {
            // Only files: dragged text keeps the textarea's own drop.
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDragging(false);
            }
          }}
          onDrop={(event) => {
            const file = event.dataTransfer.files[0];
            setDragging(false);
            if (!file) return;
            event.preventDefault();
            void readFile(file);
          }}
          className={cn(
            'rounded-lg transition-shadow duration-150 motion-reduce:transition-none',
            dragging && 'ring-3 ring-ring/50',
          )}
        >
          <Textarea
            id="compose-file"
            value={content}
            onChange={(event) => {
              setContent(event.target.value);
              setError(null);
            }}
            spellCheck={false}
            autoComplete="off"
            autoFocus
            placeholder={
              'services:\n  web:\n    image: nginx:1.27\n    ports:\n      - "8080:80"'
            }
            aria-invalid={!!error}
            className="max-h-[50dvh] min-h-48 overflow-y-auto font-mono text-xs md:text-xs"
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <FieldDescription>Paste the file or drop it here.</FieldDescription>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload data-icon="inline-start" aria-hidden="true" />
            Choose file
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept=".yml,.yaml,application/yaml,text/yaml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
              event.target.value = '';
            }}
          />
        </div>
        <FieldError>{error}</FieldError>
      </Field>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          Back
        </Button>
        <Button type="button" disabled={applying} onClick={() => void apply()}>
          {applying ? 'Checking...' : 'Apply'}
        </Button>
      </DialogFooter>
    </>
  );
};

const StatusIcon = ({ status }: { status: RowStatus }) => {
  const className = 'mt-0.5 size-4 shrink-0';

  if (status === 'loading') {
    return (
      <Loader2
        aria-hidden="true"
        className={cn(
          className,
          'animate-spin text-muted-foreground motion-reduce:animate-none',
        )}
      />
    );
  }

  return status === 'success' ? (
    <CircleCheck
      aria-hidden="true"
      className={cn(className, 'text-status-success')}
    />
  ) : (
    <CircleX
      aria-hidden="true"
      className={cn(className, 'text-status-danger')}
    />
  );
};
