import { AuthLayout } from "@/modules/auth/layouts/auth-layout";

export default function DefaultAuthLayout({ children }: LayoutProps<"/auth">) {

  return (
    <AuthLayout>
      {children}
    </AuthLayout>
  )
}
