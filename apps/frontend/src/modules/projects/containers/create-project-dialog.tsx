"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"

import { getApiErrorMessage } from "@/api"
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
import {
  GeneratedNameInput,
  generateName,
} from "@/shared/components/generated-name-input"

export type ProjectDraft = {
  name: string
}

type CreateProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (draft: ProjectDraft) => Promise<void>
  existingNames: string[]
}

const NAME_MAX_LENGTH = 48

interface Form {
  name: string
}

export const CreateProjectDialog = ({
  open,
  onOpenChange,
  onCreate,
  existingNames,
}: CreateProjectDialogProps) => {
  // Generated once, not on every render; closing the dialog resets it.
  const [initialName] = useState(generateName)
  const {
    register,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ defaultValues: { name: initialName } })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset({ name: generateName() })
    }

    onOpenChange(nextOpen)
  }

  const regenerateName = (name: string) => {
    setValue("name", name, {
      shouldValidate: true,
      shouldDirty: true,
    })
    clearErrors("root")
  }

  const onSubmit = handleSubmit(async ({ name }) => {
    clearErrors("root")

    try {
      await onCreate({ name: name.trim() })
      handleOpenChange(false)
    } catch (createError) {
      setError("root", { message: getApiErrorMessage(createError) })
    }
  })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Projects group the servers and infrastructure you operate.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} noValidate>
          <FieldGroup className="mt-6">
            <Field data-invalid={errors.name ? true : undefined}>
              <FieldLabel htmlFor="project-name">Name</FieldLabel>
              <GeneratedNameInput
                id="project-name"
                onGenerate={regenerateName}
                placeholder="platform-prod"
                maxLength={NAME_MAX_LENGTH}
                autoFocus
                aria-invalid={!!errors.name}
                {...register("name", {
                  required: "Give the project a name.",
                  maxLength: {
                    value: NAME_MAX_LENGTH,
                    message: `Keep the name under ${NAME_MAX_LENGTH} characters.`,
                  },
                  validate: (value) =>
                    !existingNames.some(
                      (existingName) =>
                        existingName.toLowerCase() ===
                        value.trim().toLowerCase()
                    ) || "A project with this name already exists.",
                })}
              />
              <FieldError errors={[errors.name]} />
            </Field>
            <FieldError>{errors.root?.message}</FieldError>
          </FieldGroup>

          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>
              Cancel
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
