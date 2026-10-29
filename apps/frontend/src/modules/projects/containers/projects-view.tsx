"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import { Button } from "@/shared/components/ui/button"
import { ProjectCard } from "../components/project-card"
import {
  SEED_PROJECTS,
  type Project,
} from "../mock-data"
import { CreateProjectDialog, type ProjectDraft } from "./create-project-dialog"

const slugify = (value: string) =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project"

export const ProjectsView = () => {
  const [projects, setProjects] = useState<Project[]>(SEED_PROJECTS)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const handleCreate = ({ name }: ProjectDraft) => {
    const project: Project = {
      id: crypto.randomUUID(),
      slug: slugify(name),
      name,
      servers: 0,
      updatedAt: "Updated just now",
    }

    setProjects((currentProjects) => [project, ...currentProjects])
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Projects
          </h1>
          <p className="mt-2.5 text-sm text-muted-foreground">
            Isolated environments for the servers and infrastructure you operate.
          </p>
        </div>

        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus aria-hidden="true" strokeWidth={2} className="size-4" />
          New project
        </Button>
      </div>

      {projects.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-dashed border-border bg-white p-6">
          <p className="text-sm text-muted-foreground">
            No projects yet. Create one to group your servers.
          </p>
          <Button variant="outline" onClick={() => setIsCreateOpen(true)}>
            <Plus aria-hidden="true" strokeWidth={2} className="size-4" />
            New project
          </Button>
        </div>
      )}

      <CreateProjectDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onCreate={handleCreate}
        existingNames={projects.map((project) => project.name)}
      />
    </>
  )
}
