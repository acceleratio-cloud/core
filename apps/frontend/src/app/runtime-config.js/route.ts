import { connection } from "next/server";

/** Set by the control plane's Traefik route: the API is served on this path. */
const API_PATH_HEADER = "x-acceleratio-api-path";

/**
 * Browser configuration read from the server's environment on every request,
 * so one image serves any deployment. The root layout loads this script before
 * hydration and src/api reads window.__ACCELERATIO_CONFIG__.
 *
 * Through the control plane URL (a custom domain), the API shares the
 * console's origin under a path prefix; through the installer's IP:NodePort
 * address it is a separate origin from API_URL.
 */
export async function GET(request: Request) {
  await connection();

  const apiPath = request.headers.get(API_PATH_HEADER);
  const config = {
    apiUrl:
      apiPath && /^\/[a-z0-9/-]*$/i.test(apiPath)
        ? apiPath
        : process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "",
  };
  // Escape "<" so a value can never close the surrounding script.
  const json = JSON.stringify(config).replace(/</g, "\\u003c");

  return new Response(`window.__ACCELERATIO_CONFIG__=${json};\n`, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: API_PATH_HEADER,
    },
  });
}
