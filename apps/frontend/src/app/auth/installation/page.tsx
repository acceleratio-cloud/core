import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getAuthStatus } from "@/api/auth/server";
import { InstallationForm } from "@/modules/auth/containers/installation-form";

export const instant = false;

export default async function InstallationPage() {
  await connection();

  const status = await getAuthStatus();

  if (status?.initialized) {
    notFound();
  }

  return (
    <div>
      <InstallationForm />
    </div>
  );
}
