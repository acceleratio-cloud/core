'use client';

import { useMemo, useRef } from 'react';

import { cn } from '@/lib/utils';
import {
  scanDotenv,
  type DotenvTokenType,
} from '@/modules/workloads/utils/dotenv';

const TOKEN_CLASS: Record<DotenvTokenType, string> = {
  plain: '',
  comment: 'text-fg-tertiary italic',
  export: 'text-fg-tertiary',
  key: 'text-fg-primary font-medium',
  operator: 'text-fg-tertiary',
  value: 'text-fg-secondary',
  string: 'text-brand-fg',
  invalid: 'text-destructive underline decoration-wavy underline-offset-4',
};

/** Shared by the textarea and the highlight layer so glyphs line up. */
const LAYER_CLASS =
  'm-0 px-3 py-2.5 font-mono text-xs leading-5 whitespace-pre [tab-size:2]';

type DotenvEditorProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

/**
 * A plain textarea over a highlighted copy of its text. The textarea keeps
 * native editing, selection, undo and paste; its glyphs are transparent so
 * the coloured layer underneath shows through, and the layer follows its
 * scroll position.
 */
export const DotenvEditor = ({
  id,
  value,
  onChange,
  disabled,
  invalid,
  describedBy,
}: DotenvEditorProps) => {
  const highlightRef = useRef<HTMLPreElement>(null);
  const tokens = useMemo(() => scanDotenv(value).tokens, [value]);

  return (
    <div
      className={cn(
        'relative h-80 overflow-hidden rounded-sm border border-input bg-surface-sunken transition-colors',
        'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        invalid && 'border-destructive ring-3 ring-destructive/20',
        disabled && 'opacity-50',
      )}
    >
      <pre
        ref={highlightRef}
        aria-hidden="true"
        className={cn(
          LAYER_CLASS,
          'pointer-events-none absolute inset-0 overflow-hidden text-fg-primary',
        )}
      >
        {tokens.map((token, index) => (
          <span key={index} className={TOKEN_CLASS[token.type]}>
            {token.text}
          </span>
        ))}
        {/* Keeps a trailing empty line as tall as the textarea's. */}
        {'\n '}
      </pre>
      <textarea
        id={id}
        value={value}
        disabled={disabled}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        wrap="off"
        placeholder={
          '# Paste a .env file\nDATABASE_URL=postgres://…\nAPI_KEY="…"'
        }
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          const layer = highlightRef.current;

          if (layer) {
            layer.scrollTop = event.currentTarget.scrollTop;
            layer.scrollLeft = event.currentTarget.scrollLeft;
          }
        }}
        className={cn(
          LAYER_CLASS,
          'absolute inset-0 size-full resize-none overflow-auto bg-transparent text-transparent caret-fg-primary outline-none',
          'selection:bg-brand/20 selection:text-transparent placeholder:text-fg-tertiary',
          'disabled:cursor-not-allowed',
        )}
      />
    </div>
  );
};
