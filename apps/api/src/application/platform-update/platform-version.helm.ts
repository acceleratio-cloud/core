import { gunzipSync } from 'node:zlib';
import type { V1Secret } from '@kubernetes/client-node';

/** The parts of a Helm release secret the console shows. */
export interface HelmReleaseInfo {
  name: string;
  namespace: string;
  chart: string | null;
  version: string | null;
  appVersion: string | null;
}

/**
 * Decodes a Helm 3 release secret (`sh.helm.release.v1.*`): the `release`
 * key is base64 of gzipped JSON, base64-encoded once more by Kubernetes.
 * Returns null when the payload is not readable.
 */
export const decodeHelmRelease = (secret: V1Secret): HelmReleaseInfo | null => {
  const encoded = secret.data?.release;

  if (!encoded) {
    return null;
  }

  try {
    const inner = Buffer.from(encoded, 'base64').toString('utf8');
    let payload = Buffer.from(inner, 'base64');

    if (payload[0] === 0x1f && payload[1] === 0x8b) {
      payload = gunzipSync(payload);
    }

    const release = JSON.parse(payload.toString('utf8')) as {
      name?: string;
      namespace?: string;
      chart?: {
        metadata?: { name?: string; version?: string; appVersion?: string };
      };
    };
    const metadata = release.chart?.metadata;

    return {
      name: release.name ?? secret.metadata?.labels?.name ?? 'unknown',
      namespace: release.namespace ?? secret.metadata?.namespace ?? '',
      chart: metadata?.name ?? null,
      version: metadata?.version ?? null,
      appVersion: metadata?.appVersion ?? null,
    };
  } catch {
    return null;
  }
};
