/**
 * Browser origins allowed to make credentialed requests: CORS_ORIGINS from the
 * environment plus the control plane URL applied in the console. Shared by
 * Nest's CORS check and better-auth's origin check, and updated at runtime so
 * a URL change takes effect without a restart.
 */
const parseOrigins = (value: string | undefined): string[] =>
  (value ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const configuredOrigins = parseOrigins(process.env.CORS_ORIGINS);
let controlPlaneOrigin: string | null = null;

export const getConfiguredOrigins = (): readonly string[] => configuredOrigins;

export const getTrustedOrigins = (): string[] =>
  controlPlaneOrigin && !configuredOrigins.includes(controlPlaneOrigin)
    ? [...configuredOrigins, controlPlaneOrigin]
    : [...configuredOrigins];

export const isTrustedOrigin = (origin: string): boolean =>
  origin === controlPlaneOrigin || configuredOrigins.includes(origin);

export const setControlPlaneOrigin = (origin: string | null): void => {
  controlPlaneOrigin = origin;
};
