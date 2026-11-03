import type { ReactNode } from "react"

type SettingsSectionProps = {
  id: string
  title: string
  description: string
  children: ReactNode
}

export const SettingsSection = ({
  id,
  title,
  description,
  children,
}: SettingsSectionProps) => {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-lg border border-border bg-surface-raised"
    >
      <header className="border-b border-border px-6 py-5">
        <h2
          id={`${id}-title`}
          className="text-base leading-none font-medium tracking-tight text-foreground"
        >
          {title}
        </h2>
        <p className="mt-2.5 text-sm text-muted-foreground">{description}</p>
      </header>

      <div className="p-6">{children}</div>
    </section>
  )
}
