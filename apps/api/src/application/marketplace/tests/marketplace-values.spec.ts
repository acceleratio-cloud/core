import type { MarketplaceTemplate } from '../marketplace-template';
import { readInputs, render, type RenderContext } from '../marketplace-values';

const context = (): RenderContext => ({
  inputs: { EMAIL: 'me@example.com' },
  hosts: { postgres: 'demo-postgres.internal' },
  appHost: 'demo-1-2-3-4.sslip.io',
  secrets: new Map(),
});

describe('render', () => {
  it('fills inputs, hosts and the app URL', () => {
    expect(
      render(
        '${{ input.EMAIL }} ${{service.postgres.host}} ${{ app.url }} ${{ app.host }}',
        context(),
      ),
    ).toBe(
      'me@example.com demo-postgres.internal https://demo-1-2-3-4.sslip.io demo-1-2-3-4.sslip.io',
    );
  });

  it('generates each secret once per deploy, in its format', () => {
    const ctx = context();
    const [first, second] = render(
      '${{ password.db }}@${{ password.db }}',
      ctx,
    ).split('@');
    expect(first).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(second).toBe(first);
    expect(render('${{ hex.key }}', ctx)).toMatch(/^[0-9a-f]{64}$/);
    expect(render('${{ base64.key }}', ctx)).toMatch(/^[A-Za-z0-9+/]{64}$/);
    expect(render('${{ password.db }}', context())).not.toBe(first);
  });

  it('leaves text without placeholders alone', () => {
    expect(render('${HOME} {{ x }}', context())).toBe('${HOME} {{ x }}');
  });
});

describe('readInputs', () => {
  const template = {
    inputs: [
      { name: 'EMAIL', label: 'Email', required: true },
      { name: 'USER', label: 'User', required: true, default: 'admin' },
      { name: 'NOTE', label: 'Note', required: false },
    ],
  } as unknown as MarketplaceTemplate;

  it('applies defaults and trims', () => {
    expect(readInputs(template, { EMAIL: ' a@b.c ' })).toEqual({
      EMAIL: 'a@b.c',
      USER: 'admin',
      NOTE: '',
    });
  });

  it('rejects missing, unknown and malformed values', () => {
    expect(() => readInputs(template, {})).toThrow('Email is required');
    expect(() => readInputs(template, null)).toThrow('Email is required');
    expect(() => readInputs(template, { EMAIL: 'a', X: 'b' })).toThrow(
      'Unknown input X',
    );
    expect(() => readInputs(template, { EMAIL: 1 })).toThrow('must be text');
    for (const value of ['a\u0000', 'a\nb', 'a\tb']) {
      expect(() => readInputs(template, { EMAIL: value })).toThrow(
        'not a valid value',
      );
    }
    expect(() => readInputs(template, [])).toThrow('inputs must be an object');
  });
});
