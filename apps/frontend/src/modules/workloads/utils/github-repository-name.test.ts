import { describe, expect, it } from 'bun:test';

import { githubRepositoryName } from './github-repository-name';

describe('githubRepositoryName', () => {
  it('reads owner/name from every common way of writing it', () => {
    for (const value of [
      'acme/api',
      ' acme/api ',
      'https://github.com/acme/api',
      'https://github.com/acme/api/',
      'https://github.com/acme/api.git',
      'http://www.github.com/acme/api',
      'github.com/acme/api',
      'https://github.com/acme/api/tree/feature/x',
      'https://github.com/acme/api/blob/main/README.md',
      'https://github.com/acme/api?tab=readme',
      'git@github.com:acme/api.git',
      'ssh://git@github.com/acme/api.git',
    ]) {
      expect(githubRepositoryName(value)).toBe('acme/api');
    }
  });

  it('keeps dots that belong to the name', () => {
    expect(githubRepositoryName('acme/acme.github.io')).toBe(
      'acme/acme.github.io',
    );
    expect(githubRepositoryName('acme/.github')).toBe('acme/.github');
  });

  it('names no repository for anything else', () => {
    for (const value of [
      '',
      'acme',
      'github.com',
      'https://github.com/acme',
      'https://gitlab.com/acme/api',
      'acme api/x',
    ]) {
      expect(githubRepositoryName(value)).toBeNull();
    }
  });
});
