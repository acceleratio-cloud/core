import type { Workload } from '@acceleratio/shared';

/**
 * Private hostname rules, mirrored from the API (`common/naming.ts` and
 * `docker-workload-network.internal.ts`): the console cannot import runtime
 * values from `@acceleratio/shared`.
 */
export const INTERNAL_HOSTNAME_MAX_LENGTH = 50;
export const INTERNAL_DNS_SUFFIX = 'internal';

const DNS1035_LABEL = /^[a-z]([a-z0-9-]*[a-z0-9])?$/;

/** Accepts `postgres` or `postgres.internal`, in any letter case. */
export const normalizeInternalHostname = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\.internal\.?$/, '');

/** What is wrong with the label, or null when the API will accept it. */
export const internalHostnameError = (value: string): string | null => {
  const hostname = normalizeInternalHostname(value);

  if (!hostname) {
    return 'Enter a hostname.';
  }

  if (hostname.length > INTERNAL_HOSTNAME_MAX_LENGTH) {
    return `Use at most ${INTERNAL_HOSTNAME_MAX_LENGTH} characters.`;
  }

  if (!/^[a-z]/.test(hostname)) {
    return 'Start with a letter.';
  }

  if (!DNS1035_LABEL.test(hostname)) {
    return 'Use lowercase letters, digits and hyphens, and do not end with a hyphen.';
  }

  return null;
};

/**
 * How other services of the project reach this one: its `.internal` name, a
 * database's read-write Service, or a bucket's name. Null for anything else.
 */
export const internalAddress = (workload: Workload): string | null => {
  if (workload.internal_domain) {
    return workload.internal_domain;
  }

  if (workload.type === 'postgres') {
    return `${workload.external_name}-rw`;
  }

  return workload.type === 's3_bucket' ? workload.external_name : null;
};
