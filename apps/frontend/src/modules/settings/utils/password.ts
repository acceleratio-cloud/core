/** Mirrors minPasswordLength in apps/api/src/vendor/auth/auth.ts. */
export const PASSWORD_MIN_LENGTH = 8;

export type PasswordFormValues = {
  current: string;
  next: string;
  confirm: string;
};

export type PasswordFormErrors = Partial<
  Record<keyof PasswordFormValues, string>
>;

export const validatePasswordForm = ({
  current,
  next,
  confirm,
}: PasswordFormValues): PasswordFormErrors => {
  const errors: PasswordFormErrors = {};

  if (!current) {
    errors.current = 'Enter your current password.';
  }

  if (next.length < PASSWORD_MIN_LENGTH) {
    errors.next = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  } else if (next === current) {
    errors.next = 'Choose a password different from the current one.';
  }

  if (!errors.next && confirm !== next) {
    errors.confirm = 'The passwords do not match.';
  }

  return errors;
};

export const describeSessionClient = (userAgent: string | null): string => {
  if (!userAgent) {
    return 'Unknown device';
  }

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /iPhone|iPad/.test(userAgent)
      ? 'iOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;

  return os ? `${browser} on ${os}` : browser;
};

export type SessionDeviceKind = 'mobile' | 'desktop';

export const sessionDeviceKind = (
  userAgent: string | null,
): SessionDeviceKind =>
  userAgent && /iPhone|iPad|Android|Mobile/.test(userAgent)
    ? 'mobile'
    : 'desktop';

/** "just now", "5 minutes ago", "3 days ago"; falls back to a date after a month. */
export const formatRelativeTime = (iso: string, now = Date.now()): string => {
  const seconds = Math.max(
    0,
    Math.round((now - new Date(iso).getTime()) / 1000),
  );

  if (seconds < 60) return 'just now';

  const units: [number, string][] = [
    [60, 'minute'],
    [60 * 60, 'hour'],
    [60 * 60 * 24, 'day'],
  ];
  const [size, name] = [...units].reverse().find(([s]) => seconds >= s)!;
  const count = Math.floor(seconds / size);

  if (name === 'day' && count >= 30) {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  }

  return `${count} ${name}${count === 1 ? '' : 's'} ago`;
};
