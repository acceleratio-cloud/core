import type { ReactNode } from "react"
import { Navbar } from "./navbar"

export const DashboardLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className="flex h-screen flex-col bg-neutral-50">
      <header className="h-12 shrink-0 border-b border-border bg-background">
        <Navbar />
      </header>
      <main
        id="main-content"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto"
      >
        {children}
      </main>
    </div>
  )
}
