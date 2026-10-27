"use client"
import { Button } from "@/shared/components/ui/button"
import { Field, FieldLabel, FieldSet } from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"
import { useForm } from "react-hook-form";

interface Form {
  email: string;
  password: string;
}

export const LoginForm = () => {
  const { register, handleSubmit } = useForm<Form>()

  const onSubmit = handleSubmit((data) => {
    console.log(data)
  })

  return (
    <div className="w-full">
      <div className="text-2xl tracking-tight font-medium leading-none">
        Sign In
      </div>
      <div className="text-sm text-muted-foreground mt-2.5">
        Welcome back. Sign in to your account.
      </div>
      <FieldSet className="my-6">
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input type="email" placeholder="name@company.com" {...register('email')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input type="password" placeholder="Enter your password" {...register('password')} />
        </Field>
      </FieldSet>
      <Button className="w-full mt-1" size="lg" onClick={onSubmit}>
        Sign In
      </Button>
    </div>
  )
}
