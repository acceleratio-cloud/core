import { connection } from "next/server";

/**
 * Liveness probe for the container HEALTHCHECK and Kubernetes. It checks only
 * that the Next.js server answers, never the API: an API outage must not make
 * the orchestrator restart the console.
 */
export async function GET() {
  await connection();

  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
