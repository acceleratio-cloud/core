'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';

const RESET_DELAY_MS = 2000;

export const CopyButton = ({
  value,
  label,
  className,
}: {
  value: string;
  label: string;
  className?: string;
}) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimeout = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimeout.current), []);

  const flash = (nextStatus: 'copied' | 'error') => {
    window.clearTimeout(resetTimeout.current);
    setStatus(nextStatus);
    resetTimeout.current = window.setTimeout(
      () => setStatus('idle'),
      RESET_DELAY_MS,
    );
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      flash('copied');
    } catch {
      flash('error');
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Copy ${label}`}
        onClick={handleCopy}
        className={cn(
          'shrink-0 text-muted-foreground transition-opacity motion-reduce:transition-none',
          status !== 'idle' && 'opacity-100',
          className,
        )}
      >
        {status === 'copied' ? (
          <Check aria-hidden="true" strokeWidth={2} className="size-3.5" />
        ) : (
          <Copy aria-hidden="true" strokeWidth={1.75} className="size-3.5" />
        )}
      </Button>
      <span role="status" className="sr-only">
        {status === 'copied'
          ? `${label} copied to clipboard.`
          : status === 'error'
            ? `Could not copy ${label}.`
            : ''}
      </span>
    </>
  );
};
