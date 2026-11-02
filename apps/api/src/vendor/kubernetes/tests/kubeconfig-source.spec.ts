import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';
import {
  INVALID_KUBECONFIG_MESSAGE,
  readKubeConfigSource,
} from '../kubeconfig-source';

jest.mock('node:os', () => {
  const actual = jest.requireActual<typeof import('node:os')>('node:os');

  return { ...actual, homedir: jest.fn(actual.homedir) };
});

const withTempDir = (run: (directory: string) => void): void => {
  const directory = mkdtempSync(join(os.tmpdir(), 'acceleratio-kubeconfig-'));

  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

describe('readKubeConfigSource', () => {
  it('returns inline YAML contents unchanged', () => {
    const contents = 'apiVersion: v1\nkind: Config\nclusters: []\n';

    expect(readKubeConfigSource(contents)).toBe(contents);
  });

  it('reads an existing kubeconfig file', () => {
    withTempDir((directory) => {
      const path = join(directory, 'config');
      const contents = 'apiVersion: v1\nkind: Config\nclusters: []\n';
      writeFileSync(path, contents);

      expect(readKubeConfigSource(path)).toBe(contents);
    });
  });

  it('leaves a missing path for the caller to reject', () => {
    const missing = join(os.tmpdir(), 'acceleratio-missing-kubeconfig');

    expect(readKubeConfigSource(missing)).toBe(missing);
  });

  it('leaves a directory path for the caller to reject', () => {
    withTempDir((directory) => {
      expect(readKubeConfigSource(directory)).toBe(directory);
    });
  });

  it('expands a leading ~ to the home directory', () => {
    withTempDir((directory) => {
      const homedir = os.homedir as jest.Mock;
      homedir.mockReturnValueOnce(directory);

      const contents = 'apiVersion: v1\nkind: Config\nclusters: []\n';
      writeFileSync(join(directory, 'config'), contents);

      expect(readKubeConfigSource('~/config')).toBe(contents);
    });
  });

  it('exposes a message that covers both supported forms', () => {
    expect(INVALID_KUBECONFIG_MESSAGE).toContain('YAML contents');
    expect(INVALID_KUBECONFIG_MESSAGE).toContain('kubeconfig file');
  });
});
