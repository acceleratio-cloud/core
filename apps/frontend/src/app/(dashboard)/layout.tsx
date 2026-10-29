import { DashboardLayout } from "@/shared/layouts/dashboard-layout";

export default function DefaultDashboardLayout({ children }: LayoutProps<"/">) {

  return (
    <DashboardLayout>
      {children}
    </DashboardLayout>
  )
}
