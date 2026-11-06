import type { MetadataRoute } from "next";

/** The console is a private control plane; no crawler should index it. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", disallow: "/" },
  };
}
