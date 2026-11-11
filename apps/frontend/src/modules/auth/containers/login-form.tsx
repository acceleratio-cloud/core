"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
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
  email: string
  password: string
}

export const LoginForm = () => {
  const router = useRouter()
  const { user, isPending, signIn } = useAuth()
  const [formError, setFormError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>()

  useEffect(() => {
    if (!isPending && user) {
      router.replace("/")
    }
  }, [isPending, user, router])

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(null)

    try {
      await signIn({ email, password })
      router.replace("/")
    } catch (error) {
      setFormError(getApiErrorMessage(error))
    }
  })

  return (
    <div className="w-full">
      <div className="font-heading text-2xl tracking-tight font-medium leading-none">
        Sign In
      </div>
      <div className="text-sm text-muted-foreground mt-2.5">
        Welcome back. Sign in to your account.
      </div>
      <form onSubmit={onSubmit} noValidate>
        <FieldSet className="my-6">
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
              autoComplete="current-password"
              placeholder="Enter your password"
              aria-invalid={!!errors.password}
              {...register("password", { required: "Enter your password" })}
            />
            <FieldError errors={[errors.password]} />
          </Field>
          <FieldError>{formError}</FieldError>
        </FieldSet>
        <Button
          type="submit"
          className="w-full mt-1"
          size="lg"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Signing in..." : "Sign In"}
        </Button>
      </form>
    </div>
  )
}
