"use client"
import { Button } from "@/shared/components/ui/button"
import { Field, FieldLabel, FieldSet } from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"
import { useForm } from "react-hook-form";

interface Form {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export const InstallationForm = () => {
  const { register, handleSubmit } = useForm<Form>()

  const onSubmit = handleSubmit((data) => {
    console.log(data)
  })

  return (
    <div className="w-full">
      <div className="text-2xl tracking-tight font-medium leading-none">
        Initial Setup
      </div>
      <div className="text-sm text-muted-foreground mt-2.5">
        Fill the form below to start working
      </div>
      <FieldSet className="my-6">
        <Field>
          <FieldLabel htmlFor="fullName">Full Name</FieldLabel>
          <Input id="fullName" placeholder="e.g. John Doe" {...register('fullName')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="email">Email</FieldLabel>
          <Input type="email" id="email" placeholder="name@company.com" {...register('email')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="password">Password</FieldLabel>
          <Input type="password" id="password" placeholder="Enter your password" {...register('password')} />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirm Password</FieldLabel>
          <Input type="password" id="confirmPassword" placeholder="Repeat your password" {...register('confirmPassword')} />
        </Field>
      </FieldSet>
      <Button className="w-full mt-1" size="lg" onClick={onSubmit}>
        Setup
      </Button>
    </div>
  )
}
