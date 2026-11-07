'use client';

import type { Ref } from 'react';
import { Search, X } from 'lucide-react';

import { Kbd } from '@/shared/components/ui/kbd';
import { MAX_LOG_SEARCH_LENGTH } from '../utils/constants';

export type FilterChip = {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
};

type LogsSearchProps = {
  value: string;
  onChange: (value: string) => void;
  /** Applies the text at once instead of after the typing pause. */
  onSubmit: () => void;
  chips: FilterChip[];
  ref?: Ref<HTMLInputElement>;
};

/**
 * Free-text search across messages (case-insensitive phrase) plus the active
 * facet filters as removable chips, so what narrows the list is always in
 * view even with the sidebar closed.
 */
export const LogsSearch = ({
  value,
  onChange,
  onSubmit,
  chips,
  ref,
}: LogsSearchProps) => (
  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
    <div className="relative min-w-48 flex-1">
      <Search
        aria-hidden="true"
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-tertiary"
      />
      <input
        ref={ref}
        type="search"
        value={value}
        maxLength={MAX_LOG_SEARCH_LENGTH}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            onSubmit();
          } else if (event.key === 'Escape' && value) {
            event.preventDefault();
            onChange('');
          }
        }}
        aria-label="Search log messages"
        placeholder="Search messages"
        spellCheck={false}
        autoComplete="off"
        className="h-8 w-full rounded-md border border-edge-default bg-surface-sunken pr-14 pl-8.5 font-mono text-xs text-fg-primary outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-fg-tertiary focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
      />
      <span className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Clear search"
            className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-fg-tertiary outline-none hover:bg-surface-muted hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-foreground/60"
          >
            <X aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
          </button>
        ) : (
          <Kbd aria-hidden="true" className="bg-surface-muted font-mono">
            /
          </Kbd>
        )}
      </span>
    </div>

    {chips.length > 0 ? (
      <ul aria-label="Active filters" className="flex flex-wrap gap-1.5">
        {chips.map((chip) => (
          <li
            key={chip.key}
            className="flex h-7 max-w-64 items-center gap-1 rounded-md border border-edge-default bg-surface-raised pr-0.5 pl-2 text-xs"
          >
            <span className="text-fg-tertiary">{chip.label}</span>
            <span
              className="truncate font-medium text-fg-primary"
              title={chip.value}
            >
              {chip.value}
            </span>
            <button
              type="button"
              onClick={chip.onRemove}
              aria-label={`Remove filter ${chip.label} ${chip.value}`}
              className="flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-fg-tertiary outline-none hover:bg-surface-muted hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-foreground/60"
            >
              <X aria-hidden="true" strokeWidth={1.75} className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    ) : null}
  </div>
);
