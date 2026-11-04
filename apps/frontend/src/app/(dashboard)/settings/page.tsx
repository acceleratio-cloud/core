import { SettingsView } from '@/modules/settings/containers/settings-view';
import { isSettingsSectionId } from '@/modules/settings/sections';

export default async function SettingsPage({
  searchParams,
}: PageProps<'/settings'>) {
  const { section } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-6 sm:px-6">
      <SettingsView
        initialSection={
          typeof section === 'string' && isSettingsSectionId(section)
            ? section
            : undefined
        }
      />
    </div>
  );
}
