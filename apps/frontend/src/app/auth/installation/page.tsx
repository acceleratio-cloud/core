import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAuthStatus } from "@/api/auth/server";
import { InstallationForm } from "@/modules/auth/containers/installation-form";

export const instant = false;

export default async function InstallationPage() {
  await connection();

  const status = await getAuthStatus();

  // Already set up: the dashboard sends signed-out visitors on to sign-in.
  if (status?.initialized) {
    redirect("/");
  }

  return (
    <div>
      <InstallationForm />
    </div>
  );
}
