'use client';

import { useState } from 'react';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import {
  Check,
  Container,
  Database,
  GitBranch,
  Plus,
  type LucideIcon,
} from 'lucide-react';

import type { Workload } from '@acceleratio/shared';
import { cn } from '@/lib/utils';
import { useProject } from '@/modules/projects/providers/project-provider';
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

/**
 * Types offered in the create dialog. Only `docker` exists in the API
 * contract today; the rest are shown as "coming soon".
 */
export type WorkloadKind = 'docker' | 'github' | 's3-bucket';

type WorkloadOption = {
  value: WorkloadKind;
  label: string;
  icon: LucideIcon;
  comingSoon?: boolean;
};

const workloadOptions: WorkloadOption[] = [
  { value: 'docker', label: 'Docker', icon: Container },
  { value: 'github', label: 'GitHub', icon: GitBranch, comingSoon: true },
  { value: 's3-bucket', label: 'S3 bucket', icon: Database, comingSoon: true },
];

type Step = 'type' | 'docker';

export const CreateWorkloadDialog = () => {
  const { project, addWorkload } = useProject();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('type');
  const [selected, setSelected] = useState<WorkloadKind>('docker');

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setStep('type');
      setSelected('docker');
    }

    setOpen(nextOpen);
  };

  const handleContinue = () => {
    if (selected !== 'docker') {
      return;
    }

    setStep('docker');
  };

  const handleCreated = (workload: Workload) => {
    addWorkload(workload);
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
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
            <RadioGroup
              value={selected}
              onValueChange={setSelected}
              aria-label="Service type"
              className="mt-5 -mx-1 -mb-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain px-1 pt-1 pb-1"
            >
              {workloadOptions.map((option) => (
                <WorkloadKindOption
                  key={option.value}
                  option={option}
                  selected={selected === option.value}
                />
              ))}
            </RadioGroup>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                Cancel
              </DialogClose>
              <Button type="button" onClick={handleContinue}>
                Continue
              </Button>
            </DialogFooter>
          </>
        ) : (
          <CreateDockerWorkloadForm
            projectId={project.id}
            onCreated={handleCreated}
            onBack={() => setStep('type')}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};

const WorkloadKindOption = ({
  option,
  selected,
}: {
  option: WorkloadOption;
  selected: boolean;
}) => {
  const Icon = option.icon;
  const labelId = `workload-type-${option.value}-label`;

  return (
    <Radio.Root
      value={option.value}
      disabled={option.comingSoon}
      aria-labelledby={labelId}
      className={cn(
        'group/option flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left outline-none select-none',
        'transition-[background-color,border-color] duration-150 ease-out motion-reduce:transition-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        option.comingSoon
          ? 'cursor-not-allowed border-border bg-muted/30'
          : selected
            ? 'cursor-pointer border-primary bg-primary'
            : 'cursor-pointer border-border bg-background hover:border-muted-foreground/40 hover:bg-muted focus-visible:border-ring',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors duration-150 motion-reduce:transition-none',
          option.comingSoon
            ? 'border-border bg-muted/40 text-muted-foreground/50'
            : selected
              ? 'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground'
              : 'border-border bg-muted/60 text-muted-foreground group-hover/option:bg-muted',
        )}
      >
        <Icon strokeWidth={1.75} className="size-4" />
      </span>

      <span
        id={labelId}
        className={cn(
          'text-sm leading-none font-medium',
          option.comingSoon
            ? 'text-muted-foreground'
            : selected
              ? 'text-primary-foreground'
              : 'text-foreground',
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
      ) : (
        <span className="ml-auto flex size-4 shrink-0 items-center justify-center">
          <Check
            aria-hidden="true"
            strokeWidth={2}
            className={cn(
              'size-4 transition-[opacity,scale] duration-150 ease-out motion-reduce:transition-none',
              selected
                ? 'scale-100 text-primary-foreground opacity-100'
                : 'scale-90 text-foreground opacity-0',
            )}
          />
        </span>
      )}
    </Radio.Root>
  );
};
