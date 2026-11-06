import type { ReactNode } from 'react';

type SettingsRowProps = {
  id: string;
  label: string;
  /** Muted line under the value: a hint or the reason it is fixed. */
  hint?: ReactNode;
  children: ReactNode;
  /** Control aligned to the right of the row, such as an Edit button. */
  action?: ReactNode;
};

/** One labeled value in a divided list: label left, value middle, action right. */
export const SettingsRow = ({
  id,
  label,
  hint,
  children,
  action,
}: SettingsRowProps) => (
  <div className="grid items-center gap-x-6 gap-y-1.5 py-4 sm:grid-cols-[168px_minmax(0,1fr)_auto]">
    <p id={`${id}-label`} className="text-[13px] text-muted-foreground">
      {label}
    </p>
    <div className="min-w-0" aria-labelledby={`${id}-label`}>
      <div className="min-h-8 text-sm text-foreground flex items-center">
        {children}
      </div>
      {hint ? (
        <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
    <div className="sm:justify-self-end">{action}</div>
  </div>
);
