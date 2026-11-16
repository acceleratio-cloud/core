"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import type { InvitePreview } from "@acceleratio/shared"

import { getApiErrorMessage } from "@/api"
import { authApi } from "@/api/auth"
import { roleLabel } from "@/modules/members/roles"
import { Button, buttonVariants } from "@/shared/components/ui/button"
import {
  Field,
  FieldError,
  FieldLabel,
  FieldSet,
} from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"

interface Form {
  fullName: string
  email: string
  password: string
  confirmPassword: string
}

export const InviteAcceptForm = ({
  token,
  invite,
}: {
  token: string
  invite: InvitePreview | null
}) => {
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Form>()

  const onSubmit = handleSubmit(async ({ fullName, email, password }) => {
    setFormError(null)

    try {
      await authApi.acceptInvite(token, { name: fullName, email, password })
      // A full load: the new session cookie replaces any earlier one.
      window.location.replace("/")
    } catch (error) {
      setFormError(getApiErrorMessage(error))
    }
  })

  if (!invite) {
    return (
      <div className="w-full">
        <div className="font-heading text-2xl tracking-tight font-medium leading-none">
          Invite link expired
        </div>
        <div className="text-sm text-muted-foreground mt-2.5">
          This link is invalid, used up or revoked. Ask whoever sent it for a
          new one.
        </div>
        <Link
          href="/auth"
          className={buttonVariants({ size: "lg", className: "w-full mt-6" })}
        >
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="font-heading text-2xl tracking-tight font-medium leading-none">
        Create your account
      </div>
      <div className="text-sm text-muted-foreground mt-2.5">
        You are invited as {roleLabel(invite.role, invite.role_name)}.
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldSet className="my-6">
          <Field>
            <FieldLabel htmlFor="fullName">Full Name</FieldLabel>
            <Input
              id="fullName"
              autoComplete="name"
              placeholder="e.g. John Doe"
              aria-invalid={!!errors.fullName}
              {...register("fullName", { required: "Enter your name" })}
            />
            <FieldError errors={[errors.fullName]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              type="email"
              id="email"
              autoComplete="email"
              placeholder="name@company.com"
              aria-invalid={!!errors.email}
              {...register("email", { required: "Enter your email" })}
            />
            <FieldError errors={[errors.email]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="password">Password</FieldLabel>
            <Input
              type="password"
              id="password"
              autoComplete="new-password"
              placeholder="Enter your password"
              aria-invalid={!!errors.password}
              {...register("password", {
                required: "Enter a password",
                minLength: {
                  value: 8,
                  message: "Password must be at least 8 characters",
                },
              })}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          <Field>
            <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
            <Input
              type="password"
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="Repeat your password"
              aria-invalid={!!errors.confirmPassword}
              {...register("confirmPassword", {
                required: "Repeat your password",
                validate: (value) =>
                  value === getValues("password") || "Passwords do not match",
              })}
            />
            <FieldError errors={[errors.confirmPassword]} />
          </Field>
          <FieldError>{formError}</FieldError>
        </FieldSet>
        <Button
          type="submit"
          className="w-full mt-1"
          size="lg"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </div>
  )
}
