import { Suspense } from 'react';

import { SettingsSkeleton } from '@/modules/settings/components/settings-skeleton';
import { SettingsView } from '@/modules/settings/containers/settings-view';
import {
  isSettingsSectionId,
  SETTINGS_TAB_PARAM,
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
        Manage storage, your profile, and the control plane.
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

  return (
    <SettingsView
      activeId={
        typeof tab === 'string' && isSettingsSectionId(tab) ? tab : undefined
      }
    />
  );
};
