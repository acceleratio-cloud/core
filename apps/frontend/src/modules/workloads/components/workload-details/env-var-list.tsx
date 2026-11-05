'use client';

import { useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, Trash2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';

export interface EnvRow {
  id: string;
  key: string;
  value: string;
}

type EnvVarListProps = {
  rows: EnvRow[];
  /** Key errors by row id. */
  errors: Record<string, string>;
  /** Rows the user added since the last save; their values start visible. */
  newRowIds: ReadonlySet<string>;
  /** Row whose name field takes focus when it mounts (the one just added). */
  autoFocusRowId?: string | null;
  disabled: boolean;
  onChange: (id: string, patch: Partial<Pick<EnvRow, 'key' | 'value'>>) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  /** A multi-line `KEY=value` paste into a name field, to expand into rows. */
  onPasteDotenv: (id: string, text: string) => void;
};

/** Looks like more than one name: several lines or a `KEY=value` pair. */
const isDotenvPaste = (text: string) =>
  /\n/.test(text.trim()) || /=/.test(text);

/**
 * Name/value rows. Saved values are masked until revealed; rows added since
 * the last save start revealed since the user is typing them. Revealing is purely
 * visual, so it stays local.
 */
export const EnvVarList = ({
  rows,
  errors,
  newRowIds,
  autoFocusRowId,
  disabled,
  onChange,
  onRemove,
  onAdd,
  onPasteDotenv,
}: EnvVarListProps) => {
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());

  const toggleReveal = (id: string) =>
    setRevealed((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });

  return (
    <div className="flex flex-col">
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 px-3 py-8 text-center">
          <KeyRound
            aria-hidden="true"
            strokeWidth={1.75}
            className="size-5 text-fg-tertiary"
          />
          <p className="text-sm text-fg-secondary">No variables yet</p>
          <p className="max-w-xs text-xs leading-relaxed text-fg-tertiary">
            Add them one by one, or paste a whole .env file into a name field or
            the Raw editor.
          </p>
        </div>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_1.75rem] gap-2 px-3 pt-3 text-xs font-medium text-fg-tertiary"
          >
            <span>Key</span>
            <span>Value</span>
          </div>
          <ul className="flex flex-col gap-2 px-3 py-2.5">
            {rows.map((row, index) => {
              const error = errors[row.id];
              // A toggle flips the row's default visibility.
              const isRevealed = revealed.has(row.id) !== newRowIds.has(row.id);
              const label = row.key || `variable ${index + 1}`;
              const errorId = `env-row-error-${row.id}`;

              return (
                <li key={row.id} className="flex flex-col gap-1">
                  <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_1.75rem] items-center gap-2">
                    <Input
                      aria-label={`Name of ${label}`}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? errorId : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="KEY"
                      autoFocus={row.id === autoFocusRowId}
                      value={row.key}
                      disabled={disabled}
                      className="h-8 font-mono text-xs md:text-xs"
                      onChange={(event) =>
                        onChange(row.id, { key: event.target.value })
                      }
                      onPaste={(event) => {
                        const text = event.clipboardData.getData('text');

                        if (isDotenvPaste(text)) {
                          event.preventDefault();
                          onPasteDotenv(row.id, text);
                        }
                      }}
                    />
                    <div className="relative">
                      <Input
                        aria-label={`Value of ${label}`}
                        type={isRevealed ? 'text' : 'password'}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="value"
                        value={row.value}
                        disabled={disabled}
                        className="h-8 pr-8 font-mono text-xs md:text-xs"
                        onChange={(event) =>
                          onChange(row.id, { value: event.target.value })
                        }
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${isRevealed ? 'Hide' : 'Show'} value of ${label}`}
                        aria-pressed={isRevealed}
                        onClick={() => toggleReveal(row.id)}
                        className="absolute top-1/2 right-1 -translate-y-1/2 text-fg-tertiary"
                      >
                        {isRevealed ? (
                          <EyeOff aria-hidden="true" strokeWidth={1.75} />
                        ) : (
                          <Eye aria-hidden="true" strokeWidth={1.75} />
                        )}
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${label}`}
                      disabled={disabled}
                      onClick={() => onRemove(row.id)}
                      className="text-fg-tertiary hover:text-destructive"
                    >
                      <Trash2 aria-hidden="true" strokeWidth={1.75} />
                    </Button>
                  </div>
                  {error ? (
                    <p id={errorId} className="px-0.5 text-xs text-destructive">
                      {error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div
        className={cn(
          'border-t border-edge-subtle px-3 py-2',
          rows.length === 0 && 'border-t-0 pt-0 pb-4 text-center',
        )}
      >
        <Button
          type="button"
          variant={rows.length === 0 ? 'outline' : 'ghost'}
          size="sm"
          disabled={disabled}
          onClick={() => {
            onAdd();
          }}
        >
          <Plus
            aria-hidden="true"
            strokeWidth={1.75}
            data-icon="inline-start"
          />
          Add variable
        </Button>
      </div>
    </div>
  );
};
