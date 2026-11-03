import Link from "next/link"
import { ArrowUpRight, Boxes } from "lucide-react"

import type { Project } from "@acceleratio/shared"
import { Skeleton } from "@/shared/components/ui/skeleton"

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
})

const formatDate = (value: string) => dateFormatter.format(new Date(value))

export const ProjectCard = ({ project }: { project: Project }) => {
  return (
    <Link
      href={`/project/${project.id}`}
      className="group flex min-h-32 flex-col rounded-lg border border-border bg-surface-raised p-4 outline-none transition-colors hover:border-input hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 text-muted-foreground transition-colors group-hover:bg-surface-panel">
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
        <span className="truncate font-mono">{project.id.slice(0, 8)}</span>
        <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
        <span className="ml-auto truncate">
          Updated {formatDate(project.updated_at)}
        </span>
      </div>
    </Link>
  )
}

export const ProjectCardSkeleton = () => {
  return (
    <div className="flex min-h-32 flex-col rounded-lg border border-border bg-surface-raised p-4">
      <div className="flex items-center gap-3">
        <Skeleton className="size-8 shrink-0" />
        <Skeleton className="h-4 min-w-0 flex-1" />
        <Skeleton className="size-3.5 shrink-0" />
      </div>

      <div className="mt-auto flex items-center gap-2.5 border-t border-border/70 pt-3">
        <Skeleton className="h-3 w-16" />
        <span aria-hidden="true" className="h-3 w-px shrink-0 bg-border" />
        <Skeleton className="ml-auto h-3 w-28" />
      </div>
    </div>
  )
}
