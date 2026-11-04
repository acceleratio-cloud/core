'use client';

import { useState, type FormEvent } from 'react';

import { Field, FieldGroup, FieldLabel } from '@/shared/components/ui/field';
import { Input } from '@/shared/components/ui/input';
import { SettingsActions } from '../components/settings-actions';
import { SettingsSection } from '../components/settings-section';

export const ProfileSettings = () => {
  const [saved, setSaved] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(true);
  };

  return (
    <SettingsSection
      id="profile"
      title="Profile"
      description="The name and email shown across the console."
    >
      <form onSubmit={handleSubmit} onChange={() => setSaved(false)}>
        <FieldGroup>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="profile-name">Full name</FieldLabel>
              <Input
                id="profile-name"
                name="full_name"
                placeholder="Your name"
                autoComplete="name"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input
                id="profile-email"
                name="email"
                type="email"
                placeholder="you@company.com"
                autoComplete="email"
              />
            </Field>
          </div>
        </FieldGroup>

        <SettingsActions saved={saved} />
      </form>
    </SettingsSection>
  );
};
