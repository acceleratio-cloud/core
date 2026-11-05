import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getServerSession } from "@/api/auth/server";
import { DashboardLayout } from "@/shared/layouts/dashboard-layout";

export const instant = false;

export default async function DefaultDashboardLayout({
  children,
}: LayoutProps<"/">) {
  await connection();

  const session = await getServerSession();

  if (!session?.user) {
    redirect("/auth");
  }

  return <DashboardLayout>{children}</DashboardLayout>;
}
