import { redirect } from "next/navigation";
import { connection } from "next/server";

import { getAuthStatus } from "@/api/auth/server";
import { LoginForm } from "@/modules/auth/containers/login-form";

export const instant = false;

export default async function Auth() {
  await connection();

  const status = await getAuthStatus();

  if (status && !status.initialized) {
    redirect("/auth/installation");
  }

  return (
    <div>
      <LoginForm />
    </div>
  );
}
