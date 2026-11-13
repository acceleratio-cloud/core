'use client';

import { useState, type FormEvent } from 'react';

import { getApiErrorMessage } from '@/api';
import { githubApi } from '@/api/github';
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

/** GitHub takes the manifest as a form POST, so the browser leaves the page. */
const postManifest = (postUrl: string, manifest: string) => {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = postUrl;
  const field = document.createElement('input');
  field.type = 'hidden';
  field.name = 'manifest';
  field.value = manifest;
  form.append(field);
  document.body.append(form);
  form.submit();
};

const NAME_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** GitHub App names are global, so the default carries a timestamp and a random suffix. */
const generateAppName = () => {
  const suffix = Array.from(
    { length: 4 },
    () => NAME_CHARS[Math.floor(Math.random() * NAME_CHARS.length)],
  ).join('');
  return `acceleratio-${Date.now()}-${suffix}`;
};

type GithubAppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const GithubAppDialog = ({
  open,
  onOpenChange,
}: GithubAppDialogProps) => {
  const [name, setName] = useState(generateAppName);
  const [organization, setOrganization] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const { post_url, manifest } = await githubApi.createManifest({
        name,
        organization,
        return_url: window.location.origin,
      });
      postManifest(post_url, manifest);
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={isSubmitting ? undefined : onOpenChange}>
      <DialogContent showCloseButton={!isSubmitting}>
        <DialogHeader>
          <DialogTitle>Create a GitHub App</DialogTitle>
          <DialogDescription>
            You will confirm the App on github.com, then come back here to
            install it on your repositories. The App and its keys belong to you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="mt-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="github-app-name">App name</FieldLabel>
              <Input
                id="github-app-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="acme-acceleratio"
                maxLength={34}
                autoComplete="off"
                disabled={isSubmitting}
              />
              <FieldDescription>
                GitHub App names are unique across all of GitHub.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="github-app-organization">
                Organization (optional)
              </FieldLabel>
              <Input
                id="github-app-organization"
                value={organization}
                onChange={(event) => setOrganization(event.target.value)}
                placeholder="acme"
                autoComplete="off"
                disabled={isSubmitting}
              />
              <FieldDescription>
                Leave empty to create the App on your own GitHub account. An App
                installs only on the account that owns it, so create one App for
                each organization.
              </FieldDescription>
            </Field>
            <FieldError>{error}</FieldError>
          </FieldGroup>

          <DialogFooter>
            <DialogClose
              render={<Button type="button" variant="ghost" />}
              disabled={isSubmitting}
            >
              Cancel
            </DialogClose>
            <Button
              type="submit"
              loading={isSubmitting}
              disabled={!name.trim()}
            >
              Continue to GitHub
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
