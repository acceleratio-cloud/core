import { Button } from "@/shared/components/ui/button"
import { Field, FieldLabel, FieldSet } from "@/shared/components/ui/field"
import { Input } from "@/shared/components/ui/input"


export const InstallationForm = () => {

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
          <FieldLabel>Full Name</FieldLabel>
          <Input placeholder="e.g. John Doe" />
        </Field>
        <Field>
          <FieldLabel>Email</FieldLabel>
          <Input placeholder="name@company.com" />
        </Field>
        <Field>
          <FieldLabel>Password</FieldLabel>
          <Input placeholder="Enter your password" />
        </Field>
        <Field>
          <FieldLabel>Confirm Password</FieldLabel>
          <Input placeholder="Repeat your password" />
        </Field>
      </FieldSet>
      <Button className="w-full mt-1" size="lg">
        Setup
      </Button>
    </div>
  )
}
