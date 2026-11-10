'use client';

import { useEffect, useState } from 'react';
import type { MarketplaceApp, Project } from '@acceleratio/shared';
import { Rocket } from 'lucide-react';
import { sileo } from 'sileo';

import { projectsApi } from '@/api/projects';
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

/** Mock: collects the deploy settings; the API has no marketplace route yet. */
export const DeployAppDialog = ({ app }: { app: MarketplaceApp }) => {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [name, setName] = useState(app.slug);

  useEffect(() => {
    projectsApi
      .list()
      .then((list) => {
        setProjects(list);
        setProjectId((current) => current ?? list[0]?.id ?? null);
      })
      .catch(() => setProjects([]));
  }, []);

  const items = (projects ?? []).map((p) => ({ value: p.id, label: p.name }));

  return (
    <Dialog>
      <DialogTrigger render={<Button size="lg" />}>
        <Rocket aria-hidden="true" strokeWidth={1.75} />
        Deploy {app.name}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="mb-3 flex items-center gap-3">
            <AppIcon src={app.icon} />
            <div>
              <DialogTitle>Deploy {app.name}</DialogTitle>
              <DialogDescription>
                Creates {formatServices(app.services.length)} in the project you
                pick.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            sileo.info({
              title: 'Marketplace deploys are not available yet',
              description: `${app.name} was not deployed. This page is a preview.`,
            });
          }}
        >
          <FieldGroup className="mt-2">
            <Field>
              <FieldLabel htmlFor="deploy-project">Project</FieldLabel>
              <Select
                value={projectId}
                items={items}
                onValueChange={(value) =>
                  typeof value === 'string' && setProjectId(value)
                }
                disabled={!projects || projects.length === 0}
              >
                <SelectTrigger id="deploy-project" className="w-full">
                  <SelectValue
                    placeholder={
                      projects === null
                        ? 'Loading projects…'
                        : 'No projects yet'
                    }
                  />
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

            <Field>
              <FieldLabel htmlFor="deploy-name">Service name</FieldLabel>
              <Input
                id="deploy-name"
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>
                Prefix for every service and volume the app creates.
              </FieldDescription>
            </Field>

            {app.inputs.map((input) => (
              <Field key={input.name}>
                <FieldLabel htmlFor={`deploy-${input.name}`}>
                  {input.label}
                </FieldLabel>
                <Input
                  id={`deploy-${input.name}`}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={input.placeholder}
                />
              </Field>
            ))}
          </FieldGroup>

          <DialogFooter className="mt-6">
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={!projectId || !name.trim()}>
              Deploy
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
