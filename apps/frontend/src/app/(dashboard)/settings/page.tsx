import { SettingsView } from '@/modules/settings/containers/settings-view';
import {
  isSettingsSectionId,
  SETTINGS_TAB_PARAM,
} from '@/modules/settings/sections';

export default async function SettingsPage({
  searchParams,
}: PageProps<'/settings'>) {
  const params = await searchParams;
  const tab = params[SETTINGS_TAB_PARAM];

  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-6 sm:px-6">
      <SettingsView
        activeId={
          typeof tab === 'string' && isSettingsSectionId(tab) ? tab : undefined
        }
      />
    </div>
  );
}
