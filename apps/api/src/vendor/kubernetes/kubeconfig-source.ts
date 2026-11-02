import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const INVALID_KUBECONFIG_MESSAGE =
  'KUBECONFIG must contain kubeconfig YAML contents or point to an existing kubeconfig file';

/**
 * The deployed platform injects kubeconfig YAML contents, while local
 * development normally points KUBECONFIG at a file, matching kubectl. Accept
 * both: an existing path is read, anything else is treated as YAML contents.
 * A leading ~ is expanded here because the environment does not expand it.
 */
export const readKubeConfigSource = (source: string): string => {
  if (source.includes('\n')) {
    return source;
  }

  const candidate = source.startsWith('~/')
    ? join(homedir(), source.slice(2))
    : source;

  if (!existsSync(candidate)) {
    return source;
  }

  try {
    if (!statSync(candidate).isFile()) {
      return source;
    }

    return readFileSync(candidate, 'utf8');
  } catch {
    return source;
  }
};
