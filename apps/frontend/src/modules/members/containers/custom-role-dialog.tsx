'use client';

import { useState, type FormEvent } from 'react';
import type {
  CustomRole,
  Project,
  ProjectAccessLevel,
} from '@acceleratio/shared';

import { getApiErrorMessage } from '@/api';
import { membersApi } from '@/api/members';
import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { LEVEL_DESCRIPTIONS, LEVEL_LABELS } from '../roles';

const NONE = 'none';
const ACCESS_ITEMS = [
  { value: NONE, label: 'No access' },
  ...(['read', 'edit', 'delete'] as const).map((level) => ({
    value: level,
    label: LEVEL_LABELS[level],
  })),
];

/** `role` null creates a new role; otherwise it is edited. */
export const CustomRoleDialog = ({
  open,
  role,
  projects,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  role: CustomRole | null;
  projects: Project[];
  onOpenChange: (open: boolean) => void;
  onSaved: (role: CustomRole) => void;
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    {open ? (
      <CustomRoleBody
        key={role?.id ?? 'new'}
        role={role}
        projects={projects}
        onSaved={(saved) => {
          onSaved(saved);
          onOpenChange(false);
        }}
      />
    ) : null}
  </Dialog>
);

const CustomRoleBody = ({
  role,
  projects,
  onSaved,
}: {
  role: CustomRole | null;
  projects: Project[];
  onSaved: (role: CustomRole) => void;
}) => {
  const [name, setName] = useState(role?.name ?? '');
  const [grants, setGrants] = useState<Record<string, ProjectAccessLevel>>(
    () =>
      Object.fromEntries(
        (role?.projects ?? []).map((grant) => [grant.project_id, grant.access]),
      ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setAccess = (projectId: string, value: string) =>
    setGrants((current) => {
      const next = { ...current };
      if (value === NONE) {
        delete next[projectId];
      } else {
        next[projectId] = value as ProjectAccessLevel;
      }
      return next;
    });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const payload = {
      name: name.trim(),
      projects: Object.entries(grants).map(([project_id, access]) => ({
        project_id,
        access,
      })),
    };

    try {
      onSaved(
        role
          ? await membersApi.updateRole(role.id, payload)
          : await membersApi.createRole(payload),
      );
    } catch (saveError) {
      setError(getApiErrorMessage(saveError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{role ? 'Edit role' : 'Create role'}</DialogTitle>
        <DialogDescription>
          Members with this role see only the projects you grant here.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={save} noValidate>
        <FieldGroup className="mt-6">
          <Field>
            <FieldLabel htmlFor="custom-role-name">Name</FieldLabel>
            <Input
              id="custom-role-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Developers"
              maxLength={255}
              autoFocus
            />
          </Field>

          <Field>
            <FieldLabel>Projects</FieldLabel>
            <FieldDescription>
              {(['read', 'edit', 'delete'] as const)
                .map((level) => `${LEVEL_LABELS[level]}: ${LEVEL_DESCRIPTIONS[level]}`)
                .join('. ')}
              .
            </FieldDescription>
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {projects.map((project) => (
                  <li
                    key={project.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span
                      className="min-w-0 truncate text-sm text-foreground"
                      title={project.name}
                    >
                      {project.name}
                    </span>
                    <Select
                      value={grants[project.id] ?? NONE}
                      items={ACCESS_ITEMS}
                      onValueChange={(value) => {
                        if (typeof value === 'string') {
                          setAccess(project.id, value);
                        }
                      }}
                    >
                      <SelectTrigger
                        size="sm"
                        className="w-32"
                        aria-label={`Access to ${project.name}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        {ACCESS_ITEMS.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <FieldError>{error}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" />}>
            Cancel
          </DialogClose>
          <Button type="submit" loading={busy} disabled={!name.trim()}>
            {role ? 'Save role' : 'Create role'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
};
