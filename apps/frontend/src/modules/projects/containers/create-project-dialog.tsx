"use client"

import { Dices } from "lucide-react"
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
import { Input } from "@/shared/components/ui/input"
import { generateProjectName } from "../utils/generate-project-name"

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
  const {
    register,
    handleSubmit,
    reset,
    clearErrors,
    setError,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ defaultValues: { name: generateProjectName() } })

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      reset({ name: generateProjectName() })
    }

    onOpenChange(nextOpen)
  }

  const regenerateName = () => {
    setValue("name", generateProjectName(), {
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
              <div className="flex items-center gap-2">
                <Input
                  id="project-name"
                  autoComplete="off"
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Generate another name"
                  title="Generate another name"
                  onClick={regenerateName}
                >
                  <Dices
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="size-4"
                  />
                </Button>
              </div>
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
