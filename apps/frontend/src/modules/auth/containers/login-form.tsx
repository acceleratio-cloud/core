import { Button } from "@/shared/components/ui/button"
import { Field, FieldLabel, FieldSet } from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"


export const LoginForm = () => {

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
          <FieldLabel>Email</FieldLabel>
          <Input placeholder="name@company.com" />
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input placeholder="Enter your password" />
        </Field>
      </FieldSet>
      <Button className="w-full mt-1" size="lg">
        Sign In
      </Button>
    </div>
  )
}
