import type { ReactNode } from 'react';

type SettingsSectionProps = {
  id: string;
  title: string;
  description: string;
  /** Optional control aligned with the title, such as a create button. */
  action?: ReactNode;
  children: ReactNode;
};

export const SettingsSection = ({
  id,
  title,
  description,
  action,
  children,
}: SettingsSectionProps) => {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-lg border border-border bg-surface-raised"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-6 py-5">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className="text-base leading-none font-medium tracking-tight text-foreground"
          >
            {title}
          </h2>
          <p className="mt-2.5 text-sm text-muted-foreground">{description}</p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>

      <div className="p-6">{children}</div>
    </section>
  );
};
