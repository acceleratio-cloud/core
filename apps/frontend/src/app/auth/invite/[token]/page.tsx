import { connection } from "next/server";

import { getApiErrorStatus } from "@/api";
import { authApi } from "@/api/auth";
import { InviteAcceptForm } from "@/modules/auth/containers/invite-accept-form";

export const instant = false;

export default async function InvitePage({
  params,
}: PageProps<"/auth/invite/[token]">) {
  await connection();

  const { token } = await params;
  // Only a 404 means the link is spent; anything else is an outage.
  const invite = await authApi.getInvite(token).catch((error: unknown) => {
    if (getApiErrorStatus(error) === 404) {
      return null;
    }
    throw error;
  });

  return (
    <div>
      <InviteAcceptForm token={token} invite={invite} />
    </div>
  );
}
