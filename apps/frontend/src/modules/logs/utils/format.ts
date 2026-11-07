/**
 * Log timestamps carry nanoseconds; `Date.parse` only reliably reads
 * milliseconds, so the fraction is cut to three digits first.
 */
export const logTimeMs = (time: string): number =>
  Date.parse(time.replace(/(\.\d{3})\d+/, '$1'));

const pad = (value: number, length = 2) => `${value}`.padStart(length, '0');

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * `Nov 07 14:52:53.676`, a fixed-width stamp so the gutter lines up; the date
 * is dropped for lines from today. Locale-independent on purpose: logs are
 * read by operators who grep and compare stamps.
 */
export const formatLogTime = (
  time: string,
  utc: boolean,
  now = Date.now(),
): string => {
  const date = new Date(logTimeMs(time));
  const parts = utc
    ? {
        month: date.getUTCMonth(),
        day: date.getUTCDate(),
        h: date.getUTCHours(),
        m: date.getUTCMinutes(),
        s: date.getUTCSeconds(),
        ms: date.getUTCMilliseconds(),
      }
    : {
        month: date.getMonth(),
        day: date.getDate(),
        h: date.getHours(),
        m: date.getMinutes(),
        s: date.getSeconds(),
        ms: date.getMilliseconds(),
      };
  const today = new Date(now);
  const sameDay = utc
    ? today.getUTCDate() === parts.day && today.getUTCMonth() === parts.month
    : today.getDate() === parts.day && today.getMonth() === parts.month;
  const clock = `${pad(parts.h)}:${pad(parts.m)}:${pad(parts.s)}.${pad(parts.ms, 3)}`;

  return sameDay ? clock : `${MONTHS[parts.month]} ${pad(parts.day)} ${clock}`;
};

const countFormat = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** `2.4K` for counts in tight spots. */
export const formatCount = (value: number) => countFormat.format(value);

const exactFormat = new Intl.NumberFormat('en');

export const formatExactCount = (value: number) => exactFormat.format(value);

/** The stable tail of a pod name (`7df88-2hnxs`), for narrow columns. */
export const shortPodName = (pod: string, serviceName?: string | null) => {
  const parts = pod.split('-');

  return parts.length > 2 ? parts.slice(-2).join('-') : (serviceName ?? pod);
};

const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * A zoomed-in window, as short as stays unambiguous: `14:00–14:30` today,
 * `Nov 6, 14:00–14:30` on another day, both dates across midnight.
 */
export const formatWindow = (start: string, end: string, now = Date.now()) => {
  const from = new Date(Date.parse(start));
  const to = new Date(Date.parse(end));
  const day = (date: Date) => dayFormat.format(date);
  const sameDay = day(from) === day(to);

  if (sameDay) {
    const prefix = day(from) === day(new Date(now)) ? '' : `${day(from)}, `;

    return `${prefix}${clockFormat.format(from)}–${clockFormat.format(to)}`;
  }

  return `${day(from)}, ${clockFormat.format(from)} – ${day(to)}, ${clockFormat.format(to)}`;
};

/** Pretty-prints a JSON message; anything else comes back unchanged. */
export const prettyMessage = (message: string): string => {
  const trimmed = message.trim();

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return message;
  }

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return message;
  }
};
