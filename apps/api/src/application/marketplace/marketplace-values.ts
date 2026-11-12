import { randomBytes, randomInt } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

import type { MarketplaceTemplate } from './marketplace-template';

/*
  Values in a template's env and command may hold `${{ ref }}` placeholders,
  filled in once per deploy:

    password.<id>        32 letters and digits
    hex.<id>             64 hex characters (32 random bytes)
    base64.<id>          64 base64 characters (48 random bytes)
    input.<NAME>         what the user typed for that input
    service.<name>.host  private hostname of a template service (`x.internal`)
    service.<name>.user / .database / .password
                         login of a `postgres` service
    app.url / app.host   the public service's https URL / hostname

  A generated value with the same ref is the same everywhere in one deploy, so
  a database and its client get one password.
*/

const PLACEHOLDER = /\$\{\{\s*([^{}]*?)\s*\}\}/g;
const SECRET_REF = /^(password|hex|base64)\.[a-z0-9_]{1,40}$/;
const INPUT_REF = /^input\.([A-Z][A-Z0-9_]{0,63})$/;
const SERVICE_REF = /^service\.([a-z0-9-]+)\.(host|user|database|password)$/;
const ALPHANUMERIC =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** What a template declares, so every ref can be checked when it loads. */
export interface RefScope {
  inputs: ReadonlySet<string>;
  services: ReadonlySet<string>;
  /** Services of type `postgres`, the only ones with a login. */
  databases: ReadonlySet<string>;
  hasPublic: boolean;
}

/** Returns why `value` holds a bad placeholder, or null when all are known. */
export const checkRefs = (value: string, scope: RefScope): string | null => {
  for (const [, ref] of value.matchAll(PLACEHOLDER)) {
    if (SECRET_REF.test(ref)) continue;
    const input = INPUT_REF.exec(ref);
    if (input) {
      if (!scope.inputs.has(input[1])) return `uses undeclared input ${ref}`;
      continue;
    }
    const service = SERVICE_REF.exec(ref);
    if (service) {
      if (!scope.services.has(service[1])) return `uses unknown ${ref}`;
      if (service[2] !== 'host' && !scope.databases.has(service[1]))
        return `uses ${ref}, but ${service[1]} is not a postgres service`;
      continue;
    }
    if (ref === 'app.url' || ref === 'app.host') {
      if (!scope.hasPublic) return `uses ${ref} without a public service`;
      continue;
    }
    return `has an unknown placeholder \${{ ${ref} }}`;
  }
  // A typo such as `${{ password.db }` would otherwise reach the env as text.
  if (value.replace(PLACEHOLDER, '').includes('${{'))
    return 'has an unclosed ${{ placeholder';
  return null;
};

export interface RenderContext {
  inputs: Readonly<Record<string, string>>;
  /** Template service name → `host`, and `user`, `database`, `password` of a postgres service. */
  services: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Hostname of the public service, when there is one. */
  appHost: string | null;
  /** Generated values of this deploy, filled as refs are first met. */
  secrets: Map<string, string>;
}

const generate = (kind: string): string => {
  if (kind === 'hex') return randomBytes(32).toString('hex');
  if (kind === 'base64') return randomBytes(48).toString('base64');
  return Array.from(
    { length: 32 },
    () => ALPHANUMERIC[randomInt(ALPHANUMERIC.length)],
  ).join('');
};

/** Fills every placeholder; refs were checked when the template loaded. */
export const render = (value: string, context: RenderContext): string =>
  value.replace(PLACEHOLDER, (_, ref: string) => {
    if (SECRET_REF.test(ref)) {
      if (!context.secrets.has(ref)) {
        context.secrets.set(ref, generate(ref.split('.')[0]));
      }
      return context.secrets.get(ref)!;
    }
    const input = INPUT_REF.exec(ref);
    if (input) return context.inputs[input[1]] ?? '';
    const service = SERVICE_REF.exec(ref);
    if (service) return context.services[service[1]][service[2]];
    if (ref === 'app.host') return context.appHost ?? '';
    if (ref === 'app.url')
      return context.appHost ? `https://${context.appHost}` : '';
    throw new Error(`Unknown placeholder ${ref}`);
  });

const INPUT_MAX_LENGTH = 4096;
// Inputs are single-line fields; a newline or tab is never meant.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Checks the user's input values against what the template declares. */
export const readInputs = (
  template: MarketplaceTemplate,
  values: unknown,
): Record<string, string> => {
  if (values != null && (typeof values !== 'object' || Array.isArray(values))) {
    throw new BadRequestException('inputs must be an object');
  }
  const given = (values ?? {}) as Record<string, unknown>;
  const known = new Set(template.inputs.map((input) => input.name));
  for (const key of Object.keys(given)) {
    if (!known.has(key))
      throw new BadRequestException(`Unknown input ${key.slice(0, 64)}`);
  }
  const result: Record<string, string> = {};
  for (const input of template.inputs) {
    const raw = given[input.name] ?? input.default ?? '';
    if (typeof raw !== 'string')
      throw new BadRequestException(`${input.label} must be text`);
    const value = raw.trim();
    if (input.required && !value)
      throw new BadRequestException(`${input.label} is required`);
    if (value.length > INPUT_MAX_LENGTH || CONTROL_CHARACTERS.test(value))
      throw new BadRequestException(`${input.label} is not a valid value`);
    result[input.name] = value;
  }
  return result;
};
