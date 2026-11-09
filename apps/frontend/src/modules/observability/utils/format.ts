import type { MetricsRange } from '@acceleratio/shared';

export type ValueFormatter = (value: number) => string;

const trim = (value: number, digits: number) =>
  Number(value.toFixed(digits)).toString();

/** Picks 0–2 fraction digits so a value always shows 3 significant digits. */
const significant = (value: number) => {
  const abs = Math.abs(value);

  if (abs >= 100 || abs === 0) {
    return trim(value, 0);
  }

  return abs >= 10 ? trim(value, 1) : trim(value, 2);
};

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

const scaleBytes = (bytes: number) => {
  let value = bytes;
  let unit = 0;

  while (Math.abs(value) >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return { value, unit: BYTE_UNITS[unit] };
};

export const formatBytes: ValueFormatter = (bytes) => {
  const { value, unit } = scaleBytes(bytes);

  return `${significant(value)} ${unit}`;
};

export const formatByteRate: ValueFormatter = (bytesPerSecond) =>
  `${formatBytes(bytesPerSecond)}/s`;

/** CPU in cores; under one core it reads as millicores (mCPU). */
export const formatCores: ValueFormatter = (cores) => {
  if (Math.abs(cores) < 1) {
    return `${Math.round(cores * 1000)} mCPU`;
  }

  const value = significant(cores);

  return `${value} ${value === '1' ? 'core' : 'cores'}`;
};

/** A plain count, such as connections; small values keep one decimal. */
export const formatCount: ValueFormatter = (value) =>
  String(Number(value.toFixed(Math.abs(value) < 10 ? 1 : 0)));

/** Events per second, such as transactions. */
export const formatPerSecond: ValueFormatter = (value) =>
  `${formatCount(value)}/s`;

export const formatPercent = (ratio: number) => {
  const percent = ratio * 100;

  if (percent > 0 && percent < 0.1) {
    return '<0.1%';
  }

  return `${percent < 10 ? Number(percent.toFixed(1)) : Math.round(percent)}%`;
};

/** Splits a formatted value into number and unit for the big stat figures. */
export const splitValue = (formatted: string) => {
  const match = /^(-?[\d.,/]+)\s*(.*)$/.exec(formatted);

  return match
    ? { number: match[1], unit: match[2] }
    : { number: formatted, unit: '' };
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

const fullFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Axis ticks: clock time, or the date for the week view. */
export const axisTimeFormatter =
  (range: MetricsRange) =>
  (seconds: number): string =>
    range === '7d'
      ? dayFormat.format(seconds * 1000)
      : timeFormat.format(seconds * 1000);

export const formatTimestamp = (seconds: number) =>
  fullFormat.format(seconds * 1000);

export const formatAgo = (milliseconds: number) => {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));

  if (seconds < 5) {
    return 'just now';
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  return `${Math.round(seconds / 60)}m ago`;
};
