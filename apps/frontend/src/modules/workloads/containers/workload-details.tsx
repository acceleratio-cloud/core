'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, LayoutDashboard, Settings, X } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Separator } from '@/shared/components/ui/separator';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/shared/components/ui/tabs';
import { DockerIcon } from '@/shared/icons/docker-icon';

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const formatDate = (value: string) => dateFormatter.format(new Date(value));

type WorkloadDetailsProps = {
  workload: Workload | null;
  onClose: () => void;
};

/**
 * Inspector for the service selected on the project canvas. The canvas owns
 * the selection; this panel only presents it.
 */
export const WorkloadDetails = ({
  workload,
  onClose,
}: WorkloadDetailsProps) => {
  useEffect(() => {
    if (!workload) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [workload, onClose]);

  if (!workload) {
    return null;
  }

  const image = workload.config.docker_image;

  return (
    <aside
      aria-label="Service details"
      className={cn(
        'absolute top-18 right-4 z-10 flex max-h-[calc(100%-5.5rem)] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden',
        'rounded-xl border border-border bg-popover text-popover-foreground',
        'animate-in fade-in slide-in-from-right-1 duration-150 ease-out motion-reduce:animate-none',
      )}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-6 py-4">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-card"
        >
          <DockerIcon className="size-5" />
        </span>

        <div className="min-w-0 flex-1">
          <h2
            title={workload.name}
            className="truncate text-base leading-tight font-medium tracking-tight text-foreground"
          >
            {workload.name}
          </h2>
          <p className="mt-1 text-xs leading-none text-muted-foreground">
            Docker service
          </p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close service details"
          onClick={onClose}
          className="-mt-0.5 -mr-2 shrink-0 text-muted-foreground"
        >
          <X aria-hidden="true" strokeWidth={1.75} />
        </Button>
      </header>

      <Tabs
        key={workload.id}
        defaultValue="overview"
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="shrink-0 px-4">
          <TabsTrigger value="overview">
            <LayoutDashboard aria-hidden="true" strokeWidth={1.75} />
            Overview
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings aria-hidden="true" strokeWidth={1.75} />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent
          value="overview"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 py-5"
        >
          <dl className="flex flex-col gap-1.5">
            <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Container image
              <CopyButton value={image} label="container image" />
            </dt>
            <dd className="font-mono text-[13px] leading-relaxed break-all text-foreground">
              {image}
            </dd>
          </dl>

          <Separator />

          <dl className="flex flex-col gap-1.5">
            <dt className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              Service ID
              <CopyButton value={workload.id} label="service ID" />
            </dt>
            <dd className="font-mono text-xs leading-relaxed break-all text-foreground">
              {workload.id}
            </dd>
          </dl>

          <Separator />

          <dl className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd className="text-[13px] text-foreground tabular-nums">
                <time dateTime={workload.createdAt} title={workload.createdAt}>
                  {formatDate(workload.createdAt)}
                </time>
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-xs text-muted-foreground">Last updated</dt>
              <dd className="text-[13px] text-foreground tabular-nums">
                <time dateTime={workload.updatedAt} title={workload.updatedAt}>
                  {formatDate(workload.updatedAt)}
                </time>
              </dd>
            </div>
          </dl>
        </TabsContent>

        <TabsContent
          value="settings"
          className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 overflow-y-auto px-6 py-10 text-center"
        >
          <span
            aria-hidden="true"
            className="mb-1 flex size-9 items-center justify-center rounded-md border border-border bg-card"
          >
            <Settings
              strokeWidth={1.5}
              className="size-4 text-muted-foreground"
            />
          </span>
          <p className="text-sm font-medium text-foreground">No settings yet</p>
          <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
            Editable service settings will appear here.
          </p>
        </TabsContent>
      </Tabs>
    </aside>
  );
};

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const resetTimeout = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(resetTimeout.current), []);

  const flash = (nextStatus: 'copied' | 'error') => {
    window.clearTimeout(resetTimeout.current);
    setStatus(nextStatus);
    resetTimeout.current = window.setTimeout(() => setStatus('idle'), 2000);
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
        className="-my-1 shrink-0 text-muted-foreground"
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
