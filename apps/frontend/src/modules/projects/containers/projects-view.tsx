"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"

import { getApiErrorMessage } from "@/api"
import { projectsApi } from "@/api/projects"
import type { Project } from "@acceleratio/shared"
import { Button } from "@/shared/components/ui/button"
import { ProjectCard, ProjectCardSkeleton } from "../components/project-card"
import { ProjectsEmptyState } from "../components/projects-empty-state"
import { CreateProjectDialog, type ProjectDraft } from "./create-project-dialog"

const SKELETON_COUNT = 6

export const ProjectsView = () => {
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  useEffect(() => {
    let active = true

    projectsApi
      .list()
      .then((items) => {
        if (active) {
          setProjects(items)
        }
      })
      .catch((requestError) => {
        if (active) {
          setError(getApiErrorMessage(requestError))
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false)
        }
      })

    return () => {
      active = false
    }
  }, [])

  const handleCreate = async ({ name }: ProjectDraft) => {
    const project = await projectsApi.create({ name })

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
          <Plus
            data-icon="inline-start"
            aria-hidden="true"
            strokeWidth={2}
          />
          New project
        </Button>
      </div>

      {isLoading ? (
        <div
          aria-busy="true"
          aria-live="polite"
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          <span className="sr-only">Loading projects...</span>
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <ProjectCardSkeleton key={index} />
          ))}
        </div>
      ) : error ? (
        <p className="mt-6 text-sm text-destructive">{error}</p>
      ) : projects.length > 0 ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <ProjectsEmptyState onCreate={() => setIsCreateOpen(true)} />
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
