'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import type { MarketplaceApp, Project } from '@acceleratio/shared';
import { Rocket } from 'lucide-react';
import { sileo } from 'sileo';

import { getApiErrorMessage } from '@/api';
import { marketplaceApi } from '@/api/marketplace';
import { projectsApi } from '@/api/projects';
import { cn } from '@/lib/utils';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
import { AppIcon } from '../components/app-icon';
import { formatServices } from '../format';

type Target = 'new' | 'existing';

const TargetOption = ({
  value,
  label,
  disabled,
}: {
  value: Target;
  label: string;
  disabled?: boolean;
}) => (
  <Radio.Root
    value={value}
    disabled={disabled}
    className={cn(
      'flex h-9 cursor-pointer items-center justify-center rounded-md px-3 text-[13px] font-medium text-muted-foreground outline-none select-none',
      'transition-colors duration-150 motion-reduce:transition-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
      'data-checked:bg-surface-raised data-checked:text-foreground data-checked:shadow-key-soft',
      'data-disabled:cursor-not-allowed data-disabled:opacity-50 data-disabled:hover:text-muted-foreground',
    )}
  >
    {label}
  </Radio.Root>
);

/** Deploys the app into a new project or one that exists, then opens it. */
export const DeployAppDialog = ({ app }: { app: MarketplaceApp }) => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      // A deploy in flight keeps the dialog open, so its error is never lost.
      onOpenChange={(next) => (next || !pending) && setOpen(next)}
    >
      <DialogTrigger render={<Button size="lg" />}>
        <Rocket aria-hidden="true" strokeWidth={1.75} />
        Deploy {app.name}
      </DialogTrigger>
      <DialogContent className="max-w-lg" showCloseButton={!pending}>
        {/* Mounted while open, so every opening starts from a fresh form and project list. */}
        <DeployAppForm
          app={app}
          pending={pending}
          setPending={setPending}
          // Next keeps this page's state for Back, so it must not stay open and locked.
          onDeployed={() => {
            setPending(false);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

const DeployAppForm = ({
  app,
  pending,
  setPending,
  onDeployed,
}: {
  app: MarketplaceApp;
  pending: boolean;
  setPending: (pending: boolean) => void;
  onDeployed: () => void;
}) => {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>('new');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState(app.name);
  const [prefix, setPrefix] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      app.inputs.map((input) => [input.name, input.default ?? '']),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    projectsApi
      .list()
      .then((list) => {
        setProjects(list);
        setProjectId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((caught) => {
        setProjects([]);
        setProjectsError(
          getApiErrorMessage(caught, 'Projects could not be loaded.'),
        );
      });
  }, []);

  const items = (projects ?? []).map((p) => ({ value: p.id, label: p.name }));
  const missing = app.inputs.some(
    (input) => input.required && !inputs[input.name]?.trim(),
  );
  const ready =
    !pending &&
    !missing &&
    (target === 'new' ? !!projectName.trim() : !!projectId);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const deployment = await marketplaceApi.deploy(app.slug, {
        ...(target === 'new'
          ? { project_name: projectName.trim() }
          : { project_id: projectId! }),
        ...(prefix.trim() ? { prefix: prefix.trim() } : {}),
        inputs,
      });
      sileo.success({
        title: `${app.name} is deploying`,
        description: deployment.url
          ? `It will answer at ${deployment.url} once it starts.`
          : undefined,
      });
      if (deployment.generated_prefix) {
        sileo.warning({
          title: 'Service names were taken',
          description: `The project already had services with these names, so they got the prefix "${deployment.generated_prefix}-".`,
        });
      }
      onDeployed();
      router.push(`/project/${deployment.project_id}`);
    } catch (caught) {
      setError(getApiErrorMessage(caught, `${app.name} was not deployed.`));
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <div className="mb-3 flex items-center gap-3">
          <AppIcon src={app.icon} />
          <div>
            <DialogTitle>Deploy {app.name}</DialogTitle>
            <DialogDescription>
              Creates {formatServices(app.services.length)} with generated
              passwords and deploys them.
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void submit();
        }}
      >
        {/* Disabled while deploying: the request already carries these values. */}
        <fieldset disabled={pending} className="contents">
          <FieldGroup className="mt-2">
            <Field>
              <FieldLabel id="deploy-target-label">Project</FieldLabel>
              <RadioGroup
                value={target}
                onValueChange={(value) => setTarget(value as Target)}
                aria-labelledby="deploy-target-label"
                disabled={pending}
                className="grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-1"
              >
                <TargetOption value="new" label="New project" />
                <TargetOption
                  value="existing"
                  label="Existing project"
                  disabled={!projects || projects.length === 0}
                />
              </RadioGroup>
              {projectsError ? (
                <FieldDescription>
                  {projectsError} Only a new project is available.
                </FieldDescription>
              ) : null}
            </Field>

            {target === 'new' ? (
              <Field>
                <FieldLabel htmlFor="deploy-project-name">
                  Project name
                </FieldLabel>
                <Input
                  id="deploy-project-name"
                  autoComplete="off"
                  value={projectName}
                  onChange={(event) => setProjectName(event.target.value)}
                />
              </Field>
            ) : (
              <Field>
                <FieldLabel htmlFor="deploy-project">Deploy into</FieldLabel>
                <Select
                  value={projectId}
                  items={items}
                  onValueChange={(value) =>
                    typeof value === 'string' && setProjectId(value)
                  }
                  disabled={pending}
                >
                  <SelectTrigger id="deploy-project" className="w-full">
                    <SelectValue placeholder="Choose a project" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="deploy-prefix">
                Service prefix
                <span className="font-normal text-muted-foreground">
                  {' '}
                  (optional)
                </span>
              </FieldLabel>
              <Input
                id="deploy-prefix"
                autoComplete="off"
                spellCheck={false}
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
              <FieldDescription>
                {app.services.length === 1
                  ? 'The service is named'
                  : 'The services are named'}{' '}
                {app.services
                  .map((service) =>
                    prefix.trim()
                      ? `${prefix.trim()}-${service.name}`
                      : service.name,
                  )
                  .join(', ')}
                .
              </FieldDescription>
            </Field>

            {app.inputs.map((input) => (
              <Field key={input.name}>
                <FieldLabel htmlFor={`deploy-${input.name}`}>
                  {input.label}
                  {input.required ? null : (
                    <span className="font-normal text-muted-foreground">
                      {' '}
                      (optional)
                    </span>
                  )}
                </FieldLabel>
                <Input
                  id={`deploy-${input.name}`}
                  autoComplete="off"
                  spellCheck={false}
                  required={input.required}
                  placeholder={input.placeholder}
                  value={inputs[input.name] ?? ''}
                  onChange={(event) =>
                    setInputs((current) => ({
                      ...current,
                      [input.name]: event.target.value,
                    }))
                  }
                />
              </Field>
            ))}

            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </fieldset>

        <DialogFooter className="mt-6">
          <DialogClose
            render={<Button type="button" variant="outline" />}
            disabled={pending}
          >
            Cancel
          </DialogClose>
          <Button type="submit" disabled={!ready}>
            {pending ? 'Deploying…' : 'Deploy'}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
};
