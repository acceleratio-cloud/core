import { Button } from '@/shared/components/ui/button';

export const SettingsActions = ({ saved }: { saved: boolean }) => {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-5">
      <Button type="submit">Save changes</Button>
      <p aria-live="polite" className="text-[13px] text-muted-foreground">
        {saved ? 'Saved.' : null}
      </p>
    </div>
  );
};
