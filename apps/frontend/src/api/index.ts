import axios from "axios";
import type { ApiErrorResponse } from "@acceleratio/shared";

declare global {
  interface Window {
    /** Set by /runtime-config.js, which the root layout loads before hydration. */
    __ACCELERATIO_CONFIG__?: { apiUrl?: string };
  }
}

const trimTrailingSlash = (url: string) => url.replace(/\/+$/, "");

/**
 * Base URL of the core API, resolved per call so a built image can be pointed
 * at any API when the container starts:
 * - browser: API_URL from the server's environment (via /runtime-config.js);
 * - server: API_INTERNAL_URL (e.g. a cluster-local Service), then API_URL.
 * NEXT_PUBLIC_API_URL, inlined by `next build`, is the fallback for local
 * development and for images that still pass it as a build argument.
 */
export const getApiBaseUrl = (): string => {
  const url =
    typeof window === "undefined"
      ? (process.env.API_INTERNAL_URL ?? process.env.API_URL)
      : window.__ACCELERATIO_CONFIG__?.apiUrl;

  return trimTrailingSlash(url || process.env.NEXT_PUBLIC_API_URL || "");
};

export const api = axios.create({
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {
  config.baseURL ??= getApiBaseUrl();
  return config;
});

export const getApiErrorMessage = (
  error: unknown,
  fallback = "Something went wrong. Please try again.",
) => {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as ApiErrorResponse | undefined;

    if (data?.message) {
      return data.message;
    }

    if (error.code === "ERR_NETWORK") {
      return "Cannot reach the API. Check that the core service is running.";
    }
  }

  return fallback;
};
