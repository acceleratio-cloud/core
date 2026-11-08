'use client';

import { useId, useMemo, useState } from 'react';
import { FileCode, KeyRound, List, RotateCw } from 'lucide-react';

import type { DockerWorkloadConfig, EnvVar } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { DetailStack } from '@/modules/workloads/components/workload-details/detail-primitives';
import { DotenvEditor } from '@/modules/workloads/components/workload-details/dotenv-editor';
import {
  EnvVarList,
  type EnvRow,
} from '@/modules/workloads/components/workload-details/env-var-list';
import {
  ENV_KEY_MESSAGE,
  ENV_KEY_PATTERN,
  formatDotenv,
  parseDotenv,
  sameEnv,
} from '@/modules/workloads/utils/dotenv';
import { UnsavedChangesBanner } from '@/modules/workloads/components/workload-details/unsaved-changes-banner';
import { useWorkloadEnv } from '@/modules/workloads/hooks/use-workload-env';
import { effectiveConfig } from '@/modules/workloads/utils/workload-config';
import { CopyButton } from '@/shared/components/copy-button';
import { Button } from '@/shared/components/ui/button';
import { FieldError } from '@/shared/components/ui/field';
import { Skeleton } from '@/shared/components/ui/skeleton';
import { useWorkloadActions } from './workload-actions';

type Mode = 'list' | 'raw';

const MODES: { value: Mode; label: string; icon: typeof List }[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'raw', label: 'Raw', icon: FileCode },
];

let rowCounter = 0;
const nextRowId = () => `env-${(rowCounter += 1)}`;

const toRows = (vars: EnvVar[]): EnvRow[] =>
  vars.map((item) => ({ id: nextRowId(), ...item }));

/** Rows the user left completely empty are not variables. */
const rowsToVars = (rows: EnvRow[]): EnvVar[] =>
  rows
    .filter((row) => row.key.trim() !== '' || row.value !== '')
    .map((row) => ({ key: row.key.trim(), value: row.value }));

const rowErrors = (rows: EnvRow[]): Record<string, string> => {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();

  for (const row of rows) {
    const key = row.key.trim();

    if (!key) {
      if (row.value !== '') {
        errors[row.id] = 'Enter a name for this value.';
      }
      continue;
    }

    if (!ENV_KEY_PATTERN.test(key)) {
      errors[row.id] = ENV_KEY_MESSAGE;
    } else if (seen.has(key)) {
      errors[row.id] = `${key} is already set above.`;
    }

    seen.add(key);
  }

  return errors;
};

/**
 * The config to save: the other settings as shown, plus the variables. `env`
 * is always sent, so an empty list removes them; `env_keys` is response-only.
 */
const withEnv = (
  config: DockerWorkloadConfig,
  env: EnvVar[],
): DockerWorkloadConfig => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { env: _env, env_keys: _keys, ...rest } = config;

  return { ...rest, env };
};

/**
 * Environment variables of a Docker service, edited as name/value rows or as
 * a raw .env file. Workload responses carry only the names, so the values are
 * loaded here. Saving stores a draft like the Configuration tab; the next
 * deploy writes the variables to the service's Kubernetes Secret.
 */
export const EditDockerWorkloadEnv = () => {
  const { workload } = useWorkloadActions();
  // A deploy, rollback, discarded draft or config save changes one of these.
  // `updated_at` is left out: it also moves on renames and canvas drags,
  // which must not refetch secret values. Saves made here refetch below.
  const revision = `${workload.active_version?.id ?? ''}|${JSON.stringify(
    workload.draft_config,
  )}`;
  const { env, error, retry } = useWorkloadEnv(
    workload.project_id,
    workload.id,
    revision,
  );

  if (env === null) {
    if (error) {
      return (
        <div className="flex flex-col items-start gap-2 px-1">
          <FieldError>{error}</FieldError>
          <Button type="button" variant="outline" size="sm" onClick={retry}>
            <RotateCw
              aria-hidden="true"
              strokeWidth={1.75}
              data-icon="inline-start"
            />
            Try again
          </Button>
        </div>
      );
    }

    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        <span className="sr-only">Loading environment variables</span>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  return <EnvEditor stored={env} onSaved={retry} />;
};

const EnvEditor = ({
  stored,
  onSaved,
}: {
  stored: EnvVar[];
  /** Reloads the stored values, which a values-only save does not reveal. */
  onSaved: () => void;
}) => {
  const { workload, pendingAction, saveConfig } = useWorkloadActions();
  const config = effectiveConfig(workload);
  const storedKey = JSON.stringify(stored);
  const editorId = useId();
  const errorsId = useId();

  const [mode, setMode] = useState<Mode>('list');
  const [rows, setRows] = useState<EnvRow[]>(() => toRows(stored));
  const [raw, setRaw] = useState(() => formatDotenv(stored));
  const [newRowIds, setNewRowIds] = useState<ReadonlySet<string>>(new Set());
  const [focusRowId, setFocusRowId] = useState<string | null>(null);
  const [modeError, setModeError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const parsedRaw = useMemo(() => parseDotenv(raw), [raw]);
  const listErrors = useMemo(() => rowErrors(rows), [rows]);
  const current = mode === 'list' ? rowsToVars(rows) : parsedRaw.vars;
  const hasErrors =
    mode === 'list'
      ? Object.keys(listErrors).length > 0
      : parsedRaw.errors.length > 0;
  // Invalid input is unsaved work too, so Reset stays reachable.
  const isDirty = hasErrors || !sameEnv(current, stored);

  const reset = (vars: EnvVar[]) => {
    setRows(toRows(vars));
    setRaw(formatDotenv(vars));
    setNewRowIds(new Set());
    setModeError(null);
    setSaveError(null);
  };

  // Follow rollbacks, discarded drafts and edits from another tab, but never
  // overwrite what the user is typing. "Typing" is measured against the env
  // the editor last showed, not the new one, so an untouched editor follows.
  const [baselineKey, setBaselineKey] = useState(storedKey);

  if (storedKey !== baselineKey) {
    const baseline = JSON.parse(baselineKey) as EnvVar[];
    const edited = hasErrors || !sameEnv(current, baseline);

    setBaselineKey(storedKey);

    if (!edited) {
      reset(stored);
    }
  }

  const switchMode = (next: Mode) => {
    if (next === mode) {
      return;
    }

    setModeError(null);

    if (next === 'raw') {
      setRaw(formatDotenv(rowsToVars(rows)));
      setMode('raw');
      return;
    }

    if (parsedRaw.errors.length > 0) {
      setModeError('Fix the errors in the file before switching to the list.');
      return;
    }

    setRows(toRows(parsedRaw.vars));
    setNewRowIds(new Set());
    setMode('list');
  };

  const updateRow = (id: string, patch: Partial<EnvVar>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );

  const addRow = () => {
    const row = { id: nextRowId(), key: '', value: '' };

    setRows((current) => [...current, row]);
    setNewRowIds((current) => new Set(current).add(row.id));
    setFocusRowId(row.id);
  };

  /** A pasted .env replaces the row it landed in, and updates rows it names. */
  const pasteDotenv = (id: string, text: string) => {
    const { vars } = parseDotenv(text);

    if (vars.length === 0) {
      // Not a parsable file: keep the text as the name.
      updateRow(id, { key: text.trim() });
      return;
    }

    const pasted = toRows(vars);

    // The updater must stay pure (React may call it twice), so the lookup it
    // consumes is built inside it.
    setRows((current) => {
      const byKey = new Map(pasted.map((row) => [row.key, row]));
      const updated = current.flatMap((row) => {
        if (row.id === id) {
          return [];
        }

        const match = byKey.get(row.key.trim());

        if (match) {
          byKey.delete(match.key);
          return [{ ...row, value: match.value }];
        }

        return [row];
      });
      const index = current.findIndex((row) => row.id === id);
      const added = pasted.filter((row) => byKey.has(row.key));

      updated.splice(index === -1 ? updated.length : index, 0, ...added);

      return updated;
    });
    setNewRowIds((current) => {
      const next = new Set(current);

      pasted.forEach((row) => next.add(row.id));

      return next;
    });
  };

  const onSave = async () => {
    setSaveError(null);

    if (hasErrors) {
      setSaveError(
        mode === 'list'
          ? 'Fix the highlighted names before saving.'
          : 'Fix the errors in the file before saving.',
      );
      return;
    }

    const env = current;

    setIsSaving(true);

    try {
      await saveConfig(withEnv(config, env));
      reset(env);
      onSaved();
    } catch (error) {
      setSaveError((error as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const isLocked = pendingAction !== null;
  const saving = isSaving || pendingAction === 'save';
  const count = current.length;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSave();
      }}
    >
      <DetailStack>
        {isDirty ? (
          <UnsavedChangesBanner
            message={saveError}
            isSaving={saving}
            isLocked={isLocked}
            onDiscard={() => reset(stored)}
          />
        ) : null}

        <div className="flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3 px-1">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-secondary">
              Environment variables
              <span className="font-normal text-fg-tertiary tabular-nums">
                {count}
              </span>
            </h3>

            <div className="flex items-center gap-1">
              {mode === 'raw' ? (
                <CopyButton value={raw} label="environment file" />
              ) : null}
              <div
                role="radiogroup"
                aria-label="Editor mode"
                className="flex items-center gap-0.5 rounded-md border border-edge-default bg-surface-raised p-0.5"
              >
                {MODES.map(({ value, label, icon: Icon }) => {
                  const active = value === mode;

                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => switchMode(value)}
                      className={cn(
                        'flex h-6 cursor-pointer items-center gap-1.5 rounded-sm px-2 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-foreground/60 motion-reduce:transition-none',
                        active
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <Icon
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="size-3.5"
                      />
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {mode === 'list' ? (
            <div className="overflow-hidden rounded-lg border border-edge-default bg-surface-raised">
              <EnvVarList
                rows={rows}
                errors={listErrors}
                newRowIds={newRowIds}
                autoFocusRowId={focusRowId}
                disabled={isLocked}
                onChange={updateRow}
                onRemove={(id) =>
                  setRows((current) => current.filter((row) => row.id !== id))
                }
                onAdd={addRow}
                onPasteDotenv={pasteDotenv}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={editorId} className="sr-only">
                Environment file
              </label>
              <DotenvEditor
                id={editorId}
                value={raw}
                onChange={(next) => {
                  setRaw(next);
                  setModeError(null);
                }}
                disabled={isLocked}
                invalid={parsedRaw.errors.length > 0}
                describedBy={parsedRaw.errors.length > 0 ? errorsId : undefined}
              />
              {parsedRaw.errors.length > 0 ? (
                <ul
                  id={errorsId}
                  className="flex flex-col gap-0.5 px-0.5 text-xs text-destructive"
                >
                  {parsedRaw.errors.slice(0, 5).map((error, index) => (
                    <li key={index}>
                      <span className="tabular-nums">Line {error.line}:</span>{' '}
                      {error.message}
                    </li>
                  ))}
                  {parsedRaw.errors.length > 5 ? (
                    <li>{parsedRaw.errors.length - 5} more errors</li>
                  ) : null}
                </ul>
              ) : (
                <p className="px-0.5 text-xs leading-relaxed text-fg-tertiary">
                  KEY=value per line. Quote values with spaces or #; lines
                  starting with # are comments.
                </p>
              )}
            </div>
          )}
          <FieldError>{modeError}</FieldError>
        </div>
      </DetailStack>
    </form>
  );
};
