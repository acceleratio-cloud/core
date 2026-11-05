const trim = (value: number, digits: number) =>
  Number(value.toFixed(digits)).toString();

/** Three significant digits at most: 0.12, 1.5, 12.4, 512. */
const significant = (value: number) => {
  const abs = Math.abs(value);

  if (abs >= 100 || abs === 0) {
    return trim(value, 0);
  }

  return abs >= 10 ? trim(value, 1) : trim(value, 2);
};

/** CPU usage in vCPU, e.g. `0.12 vCPU`; tiny non-zero usage reads `<0.01`. */
export const formatVcpu = (cores: number) => {
  if (cores > 0 && cores < 0.01) {
    return '<0.01 vCPU';
  }

  return `${significant(cores)} vCPU`;
};

const DECIMAL_BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** Bytes in decimal units (1 MB = 1,000,000 B), e.g. `7.41 MB`. */
export const formatDecimalBytes = (bytes: number) => {
  let value = bytes;
  let unit = 0;

  while (Math.abs(value) >= 1000 && unit < DECIMAL_BYTE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${significant(value)} ${DECIMAL_BYTE_UNITS[unit]}`;
};

const AGE_UNITS: [string, number][] = [
  ['d', 86_400],
  ['h', 3_600],
  ['m', 60],
];

/** Compact age since `value`: `45s`, `12m`, `10h`, `3d`. */
export const formatAge = (value: string, now = Date.now()) => {
  const seconds = Math.max(
    0,
    Math.floor((now - new Date(value).getTime()) / 1000),
  );

  for (const [unit, size] of AGE_UNITS) {
    if (seconds >= size) {
      return `${Math.floor(seconds / size)}${unit}`;
    }
  }

  return `${seconds}s`;
};
