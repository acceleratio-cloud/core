import { Suspense } from 'react';
import { connection } from 'next/server';

import { getServerSession } from '@/api/auth/server';
import { SettingsSkeleton } from '@/modules/settings/components/settings-skeleton';
import { SettingsView } from '@/modules/settings/containers/settings-view';
import {
  isSettingsSectionId,
  SETTINGS_TAB_PARAM,
  settingsSectionsFor,
} from '@/modules/settings/sections';

/**
 * The heading is static; the section depends on `?tab=`, which is request
 * data, so it streams in behind a Suspense boundary and the page shell can
 * still be prerendered for instant navigation.
 */
export default function SettingsPage({ searchParams }: PageProps<'/settings'>) {
  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
        Settings
      </h1>
      <p className="mt-2.5 text-sm text-muted-foreground">
        Manage integrations, your profile, and the control plane.
      </p>

      <Suspense fallback={<SettingsSkeleton />}>
        <SettingsSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const SettingsSection = async ({
  searchParams,
}: Pick<PageProps<'/settings'>, 'searchParams'>) => {
  const tab = (await searchParams)[SETTINGS_TAB_PARAM];
  // The session is request data: render this part at request time.
  await connection();
  const session = await getServerSession();
  const sections = settingsSectionsFor(session?.access?.role === 'custom');
  const requested =
    typeof tab === 'string' && isSettingsSectionId(tab) ? tab : undefined;

  return (
    <SettingsView
      sections={sections}
      activeId={
        sections.length === 1
          ? sections[0].id
          : requested
      }
    />
  );
};
