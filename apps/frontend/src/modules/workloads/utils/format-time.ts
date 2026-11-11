const absoluteFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const relativeFormatter = new Intl.RelativeTimeFormat('en', {
  numeric: 'auto',
});

const relativeUnits: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export const formatAbsoluteTime = (value: string) =>
  absoluteFormatter.format(new Date(value));

const preciseFormatter = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'medium',
});

/** "11 Nov 2026, 12:41:11": to the second, where a minute is too coarse. */
export const formatPreciseTime = (value: string) =>
  preciseFormatter.format(new Date(value));

/** "3 hours ago", "yesterday". Anything under a minute reads "just now". */
export const formatRelativeTime = (value: string, now = Date.now()) => {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);

  for (const [unit, size] of relativeUnits) {
    if (Math.abs(seconds) >= size) {
      return relativeFormatter.format(Math.round(seconds / size), unit);
    }
  }

  return 'just now';
};
