'use client';

import { useState, type ComponentType } from 'react';
import { ArrowLeft, Import, PanelsTopLeft, Plus } from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
import { BucketIcon } from '@/shared/icons/bucket-icon';
import { DockerIcon } from '@/shared/icons/docker-icon';
import { GithubIcon } from '@/shared/icons/github-icon';
import { PostgresIcon } from '@/shared/icons/postgres-icon';
import { RailwayIcon } from '@/shared/icons/railway-icon';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/shared/components/ui/dialog';
import { CreateDockerWorkloadForm } from './create-docker-workload-form';
import { CreateGithubWorkloadForm } from './create-github-workload-form';
import { CreatePostgresForm } from './create-postgres-form';
import { CreateS3BucketForm } from './create-s3-bucket-form';
import { CreateStaticSiteForm } from './create-static-site-form';
import { ImportComposeForm } from './import-compose-form';

/**
 * Types offered in the create dialog. `comingSoon` options are shown but
 * cannot be chosen.
 */
export type WorkloadKind =
  'docker' | 'github' | 'static' | 'postgres' | 's3-bucket';

/** Where services can be imported from. */
type ImportSource = 'compose' | 'railway';

type WorkloadOption<T extends string = WorkloadKind> = {
  value: T;
  label: string;
  icon: ComponentType<{ className?: string }>;
  comingSoon?: boolean;
};

const workloadOptions: WorkloadOption[] = [
  { value: 'docker', label: 'Docker', icon: DockerIcon },
  { value: 'github', label: 'GitHub', icon: GithubIcon },
  { value: 'static', label: 'Static site', icon: PanelsTopLeft },
  { value: 'postgres', label: 'PostgreSQL', icon: PostgresIcon },
  { value: 's3-bucket', label: 'S3 bucket', icon: BucketIcon },
];

const importOptions: WorkloadOption<ImportSource>[] = [
  { value: 'compose', label: 'Docker Compose', icon: DockerIcon },
  { value: 'railway', label: 'Railway', icon: RailwayIcon, comingSoon: true },
];

type Step = 'type' | 'import' | WorkloadKind | ImportSource;

/** The step the dialog opens at: the type list or the import sources. */
export type CreateStart = 'type' | 'import';

/** Open state lives with the canvas, whose empty state opens it too. */
export const CreateWorkloadDialog = ({
  open,
  start = 'type',
  onOpenChange,
}: {
  open: boolean;
  start?: CreateStart;
  onOpenChange: (open: boolean) => void;
}) => {
  const { project, addWorkload } = useProject();
  const [step, setStep] = useState<Step>(start);
  const [wasOpen, setWasOpen] = useState(open);

  // Each opening starts at `start`. The step is left alone on close, so the
  // closing dialog fades out on the screen it was showing.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep(start);
    }
  }

  const handleCreated = (workload: Workload) => {
    addWorkload(workload);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger
        render={<Button type="button" className={'rounded-lg h-9'} />}
      >
        <Plus aria-hidden="true" strokeWidth={2} className="size-4" />
        Create service
      </DialogTrigger>

      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col">
        {step === 'type' ? (
          <>
            <DialogHeader>
              <DialogTitle>Create service</DialogTitle>
              <DialogDescription>
                Choose a service type to add to this project.
              </DialogDescription>
            </DialogHeader>

            {/* Inset padding keeps the 3px focus ring clear of the scroll edges. */}
            <div
              role="group"
              aria-label="Service type"
              className="mt-5 -mx-1 -mb-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1 pt-1 pb-1"
            >
              {workloadOptions.map((option) => (
                <WorkloadKindOption
                  key={option.value}
                  option={option}
                  onSelect={() => setStep(option.value)}
                />
              ))}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="sm:mr-auto"
                onClick={() => setStep('import')}
              >
                <Import data-icon="inline-start" aria-hidden="true" />
                Import from…
              </Button>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                Cancel
              </DialogClose>
            </DialogFooter>
          </>
        ) : step === 'import' ? (
          <>
            <DialogHeader>
              <DialogTitle>Import services</DialogTitle>
              <DialogDescription>
                Bring the services of an existing setup into this project.
              </DialogDescription>
            </DialogHeader>

            <div
              role="group"
              aria-label="Import from"
              className="mt-5 -mx-1 -mb-1 flex flex-col gap-2 px-1 pt-1 pb-1"
            >
              {importOptions.map((option) => (
                <WorkloadKindOption
                  key={option.value}
                  option={option}
                  onSelect={() => setStep(option.value)}
                />
              ))}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep('type')}
              >
                <ArrowLeft data-icon="inline-start" aria-hidden="true" />
                Back
              </Button>
            </DialogFooter>
          </>
        ) : step === 'compose' ? (
          <ImportComposeForm
            projectId={project.id}
            onDone={() => onOpenChange(false)}
            onBack={() => setStep('import')}
          />
        ) : step === 'docker' ? (
          <CreateDockerWorkloadForm
            projectId={project.id}
            onCreated={handleCreated}
            onBack={() => setStep('type')}
          />
        ) : step === 'github' ? (
          <CreateGithubWorkloadForm
            projectId={project.id}
            onCreated={handleCreated}
            onBack={() => setStep('type')}
          />
        ) : step === 'static' ? (
          <CreateStaticSiteForm
            projectId={project.id}
            onCreated={handleCreated}
            onBack={() => setStep('type')}
          />
        ) : step === 'postgres' ? (
          <CreatePostgresForm
            projectId={project.id}
            onCreated={handleCreated}
            onBack={() => setStep('type')}
          />
        ) : step === 's3-bucket' ? (
          <CreateS3BucketForm
            projectId={project.id}
            onCreated={handleCreated}
            onBack={() => setStep('type')}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const WorkloadKindOption = ({
  option,
  onSelect,
}: {
  option: WorkloadOption<string>;
  onSelect: () => void;
}) => {
  const Icon = option.icon;

  return (
    <button
      type="button"
      disabled={option.comingSoon}
      onClick={onSelect}
      className={cn(
        'group/option flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none select-none',
        'transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        option.comingSoon
          ? 'cursor-not-allowed border-border bg-muted/30'
          : 'cursor-pointer border-border bg-background hover:border-muted-foreground/40 hover:bg-muted focus-visible:border-ring',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 motion-reduce:transition-none',
          option.comingSoon
            ? 'border-border bg-muted/40 text-muted-foreground/50'
            : 'border-border bg-muted/60 text-muted-foreground group-hover/option:bg-muted',
        )}
      >
        <Icon className="size-4" />
      </span>

      <span
        className={cn(
          'text-sm leading-none font-medium',
          option.comingSoon ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {option.label}
        {option.comingSoon ? (
          <span className="sr-only"> (coming soon)</span>
        ) : null}
      </span>

      {option.comingSoon ? (
        <span className="ml-auto shrink-0 rounded-full border border-border bg-background px-2 py-[3px] text-[10px] leading-none font-medium whitespace-nowrap text-muted-foreground">
          Coming soon
        </span>
      ) : null}
    </button>
  );
};
