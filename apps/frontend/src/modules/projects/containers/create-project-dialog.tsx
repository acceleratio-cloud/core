"use client"

import { useState, type FormEvent } from "react"

import { Button } from "@/shared/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"

export type ProjectDraft = {
  name: string
}

type CreateProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (draft: ProjectDraft) => void
  existingNames: string[]
}

const NAME_MAX_LENGTH = 48

export const CreateProjectDialog = ({
  open,
  onOpenChange,
  onCreate,
  existingNames,
}: CreateProjectDialogProps) => {
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName("")
    setError(null)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset()
    }

    onOpenChange(nextOpen)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = name.trim()

    if (!trimmedName) {
      setError("Give the project a name.")
      return
    }

    if (trimmedName.length > NAME_MAX_LENGTH) {
      setError(`Keep the name under ${NAME_MAX_LENGTH} characters.`)
      return
    }

    if (
      existingNames.some(
        (existingName) => existingName.toLowerCase() === trimmedName.toLowerCase()
      )
    ) {
      setError("A project with this name already exists.")
      return
    }

    setError(null)
    onCreate({ name: trimmedName })
    handleOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Projects group the servers and infrastructure you operate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate>
          <FieldGroup className="mt-6">
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <Input
                id="project-name"
                name="name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
                placeholder="platform-prod"
                maxLength={NAME_MAX_LENGTH}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "project-name-error" : undefined}
                autoFocus
              />
              <FieldError id="project-name-error">{error}</FieldError>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button type="submit">Create project</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
