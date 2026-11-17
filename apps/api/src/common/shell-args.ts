/**
 * Splits a shell-style line into arguments, the way `docker run` and Docker
 * Compose read a string `command`: whitespace separates arguments, single
 * quotes keep text literally, double quotes keep spaces and allow `\"` and
 * `\\`, and a backslash outside quotes escapes the next character. Nothing is
 * expanded. The console has its own copy
 * (`apps/frontend/src/modules/workloads/utils/shell-args.ts`), since it cannot
 * import runtime code from `@acceleratio/shared`: change both together.
 */
export const parseShellArgs = (line: string): string[] => {
  const args: string[] = [];
  let current = '';
  // An argument exists once anything, even an empty pair of quotes, starts it.
  let started = false;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (quote === '"') {
      if (char === '"') {
        quote = null;
      } else if (
        char === '\\' &&
        (line[index + 1] === '"' || line[index + 1] === '\\')
      ) {
        current += line[index + 1];
        index += 1;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (char === '\\') {
      if (index + 1 < line.length) {
        current += line[index + 1];
        index += 1;
      }
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = '';
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }

  if (quote !== null) {
    throw new Error(`Close the ${quote === '"' ? 'double' : 'single'} quote.`);
  }

  if (started) {
    args.push(current);
  }

  return args;
};
