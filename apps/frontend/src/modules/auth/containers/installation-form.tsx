"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"

import { getApiErrorMessage } from "@/api"
import { useAuth } from "@/modules/auth/providers/auth-provider"
import { Button } from "@/shared/components/ui/button"
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

export const InstallationForm = () => {
  const { signUp } = useAuth()
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
      await signUp({ name: fullName, email, password })
      // A full load: the client router still holds the redirects it got
      // before the account existed ("/" -> /auth -> /auth/installation).
      window.location.replace("/")
    } catch (error) {
      setFormError(getApiErrorMessage(error))
    }
  })

  return (
    <div className="w-full">
      <div className="font-heading text-2xl tracking-tight font-medium leading-none">
        Initial Setup
      </div>
      <div className="text-sm text-muted-foreground mt-2.5">
        Fill the form below to start working
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
          {isSubmitting ? "Setting up..." : "Setup"}
        </Button>
      </form>
    </div>
  )
}
