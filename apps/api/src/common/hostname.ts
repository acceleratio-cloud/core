import { isIP } from 'node:net';

const HOSTNAME_MAX_LENGTH = 253;
/** One DNS label: letters, digits and inner hyphens, 1–63 characters. */
export const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TLD_PATTERN = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

/**
 * A lowercase public hostname with at least two labels: no IP address, no
 * `localhost`, no trailing dot.
 */
export const isValidHostname = (hostname: string): boolean => {
  if (
    !hostname ||
    hostname.length > HOSTNAME_MAX_LENGTH ||
    isIP(hostname.replace(/^\[|\]$/g, '')) !== 0
  ) {
    return false;
  }

  const labels = hostname.split('.');
  if (labels.length < 2 || labels.at(-1) === 'localhost') {
    return false;
  }

  return (
    labels.every((label) => DNS_LABEL_PATTERN.test(label)) &&
    TLD_PATTERN.test(labels.at(-1) ?? '')
  );
};
