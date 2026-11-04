import type { ReactNode } from "react"
import { Navbar } from "./navbar"

export const DashboardLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex h-screen flex-col bg-surface-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:border focus:border-foreground/50 focus:bg-background focus:px-3 focus:py-1.5 focus:text-[13px] focus:font-medium focus:text-foreground"
      >
        Skip to content
      </a>
      <header className="h-12 shrink-0">
        <Navbar />
      </header>
      <div className="flex min-h-0 flex-1 flex-col px-2 pb-2 sm:px-3 sm:pb-3">
        <main
          id="main-content"
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto rounded-xl border border-border bg-surface-panel"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
