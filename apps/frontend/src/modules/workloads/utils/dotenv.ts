import type { EnvVar } from '@acceleratio/shared';

/** Mirrors the API rule: POSIX shell names, which envFrom accepts as-is. */
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const ENV_KEY_MESSAGE =
  'Use letters, digits and underscores, not starting with a digit.';

export type DotenvTokenType =
  | 'plain'
  | 'comment'
  | 'export'
  | 'key'
  | 'operator'
  | 'value'
  | 'string'
  | 'invalid';

export interface DotenvToken {
  type: DotenvTokenType;
  text: string;
}

export interface DotenvError {
  line: number;
  message: string;
}

export interface DotenvScan {
  vars: EnvVar[];
  errors: DotenvError[];
  /** Concatenated, the tokens reproduce the input exactly. */
  tokens: DotenvToken[];
}

const DOUBLE_QUOTE_ESCAPES: Record<string, string> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '\\': '\\',
};

const isBlank = (char: string | undefined) => char === ' ' || char === '\t';

/**
 * Reads a `.env` file the way most dotenv loaders do, without expanding
 * `$VARS`:
 * - `KEY=value`, with an optional `export ` prefix; `#` starts a comment line
 * - unquoted values are trimmed and end at a ` #` comment
 * - single quotes keep text literally; double quotes allow `\n`, `\t`, `\"`
 *   and `\\`; both may span lines
 *
 * One scan feeds both the parsed variables and the editor's highlighting, so
 * what is coloured as a value is what gets saved.
 */
export const scanDotenv = (text: string): DotenvScan => {
  const vars: EnvVar[] = [];
  const errors: DotenvError[] = [];
  const tokens: DotenvToken[] = [];
  const seen = new Map<string, number>();
  let pos = 0;
  let line = 1;

  const push = (type: DotenvTokenType, end: number) => {
    if (end <= pos) {
      return;
    }

    const chunk = text.slice(pos, end);
    const last = tokens[tokens.length - 1];

    if (last?.type === type) {
      last.text += chunk;
    } else {
      tokens.push({ type, text: chunk });
    }

    for (const char of chunk) {
      if (char === '\n') {
        line += 1;
      }
    }

    pos = end;
  };

  const lineEnd = (from: number) => {
    const index = text.indexOf('\n', from);

    return index === -1 ? text.length : index;
  };

  const skipBlanks = (type: DotenvTokenType = 'plain') => {
    let end = pos;

    while (isBlank(text[end])) {
      end += 1;
    }

    push(type, end);
  };

  /** Spaces then an optional `# comment` up to the end of the line. */
  const readTrailing = () => {
    skipBlanks();

    // The `\r` of a CRLF line ending is not text after the value.
    if (text[pos] === '\r' && lineEnd(pos) === pos + 1) {
      push('plain', pos + 1);
    } else if (text[pos] === '#') {
      push('comment', lineEnd(pos));
    } else if (pos < lineEnd(pos)) {
      errors.push({ line, message: 'Unexpected text after the value.' });
      push('invalid', lineEnd(pos));
    }
  };

  const readQuoted = (quote: "'" | '"'): string | null => {
    const startLine = line;
    let value = '';
    let end = pos + 1;

    while (end < text.length && text[end] !== quote) {
      if (quote === '"' && text[end] === '\\' && end + 1 < text.length) {
        const next = text[end + 1];

        value += DOUBLE_QUOTE_ESCAPES[next] ?? `\\${next}`;
        end += 2;
        continue;
      }

      value += text[end];
      end += 1;
    }

    if (end >= text.length) {
      push('invalid', text.length);
      errors.push({
        line: startLine,
        message: `Missing closing ${quote === '"' ? 'double' : 'single'} quote.`,
      });

      return null;
    }

    push('string', end + 1);

    return value;
  };

  const readUnquoted = (): string => {
    const end = lineEnd(pos);
    let valueEnd = end;

    for (let index = pos; index < end; index += 1) {
      // A `#` starts a comment only after whitespace, so `color=#fff` works.
      if (text[index] === '#' && isBlank(text[index - 1])) {
        valueEnd = index;
        break;
      }
    }

    let trimmedEnd = valueEnd;

    while (trimmedEnd > pos && isBlank(text[trimmedEnd - 1])) {
      trimmedEnd -= 1;
    }

    const value = text.slice(pos, trimmedEnd);

    push('value', trimmedEnd);
    push('plain', valueEnd);
    push('comment', end);

    return value;
  };

  while (pos < text.length) {
    skipBlanks();

    if (pos >= text.length) {
      break;
    }

    if (text[pos] === '\n' || text[pos] === '\r') {
      push('plain', pos + 1);
      continue;
    }

    if (text[pos] === '#') {
      push('comment', lineEnd(pos));
      continue;
    }

    const match = /^export[ \t]+/.exec(text.slice(pos, lineEnd(pos)));

    if (match && text.slice(pos, lineEnd(pos)).includes('=')) {
      push('export', pos + 'export'.length);
      skipBlanks();
    }

    const end = lineEnd(pos);
    const equals = text.indexOf('=', pos);

    if (equals === -1 || equals > end) {
      errors.push({ line, message: 'Expected KEY=value.' });
      push('invalid', end);
      continue;
    }

    const keyLine = line;
    const key = text.slice(pos, equals).trim();
    let valid = true;

    if (!ENV_KEY_PATTERN.test(key)) {
      errors.push({
        line: keyLine,
        message: key ? `${key}: ${ENV_KEY_MESSAGE}` : 'Missing variable name.',
      });
      valid = false;
    } else if (seen.has(key)) {
      errors.push({
        line: keyLine,
        message: `${key} is already set on line ${seen.get(key)}.`,
      });
      valid = false;
    }

    push(valid ? 'key' : 'invalid', equals);
    push('operator', equals + 1);
    skipBlanks();

    let value: string | null;

    if (text[pos] === '"' || text[pos] === "'") {
      value = readQuoted(text[pos] as "'" | '"');

      if (value !== null) {
        readTrailing();
      }
    } else {
      value = readUnquoted();
    }

    if (valid && value !== null) {
      seen.set(key, keyLine);
      vars.push({ key, value: value.replace(/\r$/, '') });
    }
  }

  return { vars, errors, tokens };
};

export const parseDotenv = (text: string) => {
  const { vars, errors } = scanDotenv(text);

  return { vars, errors };
};

/** Safe to leave unquoted: no spaces, quotes, `#`, backslashes or newlines. */
const BARE_VALUE = /^[^\s'"#\\]*$/;

/** Writes variables as a `.env` file that `parseDotenv` reads back unchanged. */
export const formatDotenv = (vars: EnvVar[]): string =>
  vars
    .map(({ key, value }) => {
      if (BARE_VALUE.test(value)) {
        return `${key}=${value}`;
      }

      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');

      return `${key}="${escaped}"`;
    })
    .join('\n');

export const sameEnv = (left: EnvVar[], right: EnvVar[]) =>
  left.length === right.length &&
  left.every(
    (item, index) =>
      item.key === right[index].key && item.value === right[index].value,
  );
