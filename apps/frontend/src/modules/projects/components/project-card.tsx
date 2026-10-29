import Link from "next/link"
import { ArrowUpRight, Boxes, Server } from "lucide-react"

import type { Project } from "../mock-data"

export const ProjectCard = ({ project }: { project: Project }) => {
  return (
    <Link
      href={`/projects/${project.slug}`}
      className="group flex min-h-32 flex-col rounded-lg border border-border bg-white p-4 outline-none transition-colors hover:border-input hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 text-muted-foreground transition-colors group-hover:bg-white">
          <Boxes aria-hidden="true" strokeWidth={1.75} className="size-4" />
        </span>

        <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {project.name}
        </h2>

        <ArrowUpRight
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground"
        />
      </div>

      <div className="mt-auto flex items-center gap-2.5 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
        <span className="truncate font-mono">{project.slug}</span>
        <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
        <span className="inline-flex shrink-0 items-center gap-1">
          <Server aria-hidden="true" strokeWidth={1.75} className="size-3" />
          {project.servers}
          <span className="sr-only">servers</span>
        </span>
        <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
        <span className="ml-auto truncate">{project.updatedAt}</span>
      </div>
    </Link>
  )
}
