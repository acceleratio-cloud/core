import { connection } from "next/server";

/**
 * Browser configuration read from the server's environment on every request,
 * so one image serves any deployment. The root layout loads this script before
 * hydration and src/api reads window.__ACCELERATIO_CONFIG__.
 */
export async function GET() {
  await connection();

  const config = {
    apiUrl: process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "",
  };
  // Escape "<" so a value can never close the surrounding script.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");

  return new Response(`window.__ACCELERATIO_CONFIG__=${json};\n`, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
