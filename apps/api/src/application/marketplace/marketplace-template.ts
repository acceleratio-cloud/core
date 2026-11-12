import {
  MARKETPLACE_CATEGORIES,
  type MarketplaceApp,
  type MarketplaceCategory,
  type MarketplaceInput,
  type MarketplaceService,
  type EnvVar,
} from '@acceleratio/shared';

import { normalizeMountPath } from '@/application/workload/docker/docker-workload.config';

import { checkRefs, type RefScope } from './marketplace-values';

/*
  Strict reader for templates/apps/<slug>.yaml. A template describes containers
  that run in a user's cluster, so anything the schema does not name (a
  privileged flag, a host path, a raw manifest) is rejected rather than ignored.
*/

export const TEMPLATE_SCHEMA_VERSION = 1;

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SERVICE_NAME = /^[a-z](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
const INPUT_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
// registry/path:tag, the tag explicit and not `latest`; an optional @sha256 digest.
const IMAGE =
  /^[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*:(?!latest(?:$|@))[\w][\w.-]{0,127}(?:@sha256:[a-f0-9]{64})?$/;
const MAX_SERVICES = 10;
// The same rules the Docker service settings apply.
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_VOLUMES = 10;
const MAX_VOLUME_GIB = 100;

/** A service as the API deploys it; `env` and `command` never reach the console. */
export interface TemplateService extends MarketplaceService {
  env: EnvVar[];
  command?: string[];
}

export interface MarketplaceTemplate extends MarketplaceApp {
  services: TemplateService[];
}

export class TemplateError extends Error {}

type Raw = Record<string, unknown>;

const fail = (path: string, message: string): never => {
  throw new TemplateError(`${path}: ${message}`);
};

const object = (value: unknown, path: string, keys: string[]): Raw => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'must be a mapping');
  }
  for (const key of Object.keys(value as Raw)) {
    if (!keys.includes(key)) fail(`${path}.${key}`, 'is not a known field');
  }
  return value as Raw;
};

const text = (value: unknown, path: string, max = 200): string => {
  if (typeof value !== 'string' || !value.trim()) fail(path, 'must be text');
  if ((value as string).length > max)
    fail(path, `must be ${max} characters or fewer`);
  return (value as string).trim();
};

const match = (value: unknown, path: string, pattern: RegExp, what: string) => {
  const result = text(value, path);
  if (!pattern.test(result)) fail(path, `must be ${what}`);
  return result;
};

const number = (
  value: unknown,
  path: string,
  min: number,
  max: number,
  integer = true,
) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    fail(
      path,
      `must be ${integer ? 'a whole number' : 'a number'} from ${min} to ${max}`,
    );
  }
  return value as number;
};

const list = <T>(
  value: unknown,
  path: string,
  max: number,
  read: (item: unknown, path: string) => T,
): T[] => {
  if (!Array.isArray(value)) fail(path, 'must be a list');
  const items = value as unknown[];
  if (items.length > max) fail(path, `must have ${max} items or fewer`);
  return items.map((item, index) => read(item, `${path}[${index}]`));
};

const httpsUrl = (value: unknown, path: string) => {
  const result = text(value, path);
  let url: URL | null = null;
  try {
    url = new URL(result);
  } catch {
    // reported below
  }
  if (url?.protocol !== 'https:') fail(path, 'must be an https URL');
  return result;
};

const unique = (names: string[], path: string) => {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) fail(path, `has "${name}" twice`);
    seen.add(name);
  }
};

/** Looks up an icon by name; returns undefined when the file is missing. */
export type IconLookup = (name: string) => string | undefined;

const icon = (value: unknown, path: string, icons: IconLookup) => {
  const name = match(
    value,
    path,
    SLUG_PATTERN,
    'an icon name from templates/icons',
  );
  return icons(name) ?? fail(path, `has no file templates/icons/${name}.svg`);
};

const volume = (value: unknown, path: string) => {
  const raw = object(value, path, ['path', 'size_gib']);
  let mount = '';
  try {
    // The same check a Docker service applies, so a bad path fails at load, not at deploy.
    mount = normalizeMountPath(raw.path);
  } catch (error) {
    fail(`${path}.path`, (error as Error).message);
  }
  return {
    path: mount,
    size_gib: number(raw.size_gib, `${path}.size_gib`, 1, MAX_VOLUME_GIB),
  };
};

const scalar = (value: unknown, path: string): string => {
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (typeof value !== 'string')
    fail(path, 'must be text, a number or a boolean');
  if ((value as string).length > 4096)
    fail(path, 'must be 4096 characters or fewer');
  return value as string;
};

const POSTGRES_PORT = 5432;

/** A managed PostgreSQL database: a name, an icon and a disk; nothing to run. */
const postgresService = (
  raw: Raw,
  path: string,
  icons: IconLookup,
): TemplateService => {
  object(raw, path, ['name', 'type', 'icon', 'size_gib']);
  return {
    name: match(
      raw.name,
      `${path}.name`,
      SERVICE_NAME,
      'lowercase letters, digits and hyphens',
    ),
    type: 'postgres',
    icon: icon(raw.icon, `${path}.icon`, icons),
    port: POSTGRES_PORT,
    size_gib: number(raw.size_gib, `${path}.size_gib`, 1, MAX_VOLUME_GIB),
    env: [],
  };
};

const service = (
  value: unknown,
  path: string,
  icons: IconLookup,
): TemplateService => {
  const type = (value as Raw | null)?.type;
  if (type === 'postgres') return postgresService(value as Raw, path, icons);
  if (type !== undefined && type !== 'docker')
    fail(`${path}.type`, 'must be docker or postgres');
  const raw = object(value, path, [
    'name',
    'type',
    'image',
    'icon',
    'port',
    'public',
    'volumes',
    'env',
    'command',
  ]);
  const result: TemplateService = {
    name: match(
      raw.name,
      `${path}.name`,
      SERVICE_NAME,
      'lowercase letters, digits and hyphens',
    ),
    type: 'docker',
    image: match(
      raw.image,
      `${path}.image`,
      IMAGE,
      'an image with an explicit tag other than latest',
    ),
    icon: icon(raw.icon, `${path}.icon`, icons),
    env: [],
  };
  if (raw.port !== undefined)
    result.port = number(raw.port, `${path}.port`, 1, 65535);
  if (raw.public !== undefined) {
    if (typeof raw.public !== 'boolean')
      fail(`${path}.public`, 'must be true or false');
    if (raw.public) {
      if (result.port === undefined) fail(`${path}.public`, 'needs a port');
      result.public = true;
    }
  }
  if (raw.volumes !== undefined) {
    result.volumes = list(raw.volumes, `${path}.volumes`, MAX_VOLUMES, volume);
    unique(
      result.volumes.map((v) => v.path),
      `${path}.volumes`,
    );
  }
  if (raw.env !== undefined) {
    const env = object(raw.env, `${path}.env`, Object.keys(raw.env ?? {}));
    result.env = Object.entries(env).map(([key, item]) => {
      if (!ENV_KEY.test(key)) fail(`${path}.env.${key}`, 'is not a valid name');
      return { key, value: scalar(item, `${path}.env.${key}`) };
    });
  }
  if (raw.command !== undefined) {
    result.command = list(raw.command, `${path}.command`, 64, (item, at) =>
      scalar(item, at),
    );
  }
  return result;
};

const input = (value: unknown, path: string): MarketplaceInput => {
  const raw = object(value, path, [
    'name',
    'label',
    'placeholder',
    'default',
    'required',
  ]);
  const result: MarketplaceInput = {
    name: match(raw.name, `${path}.name`, INPUT_NAME, 'UPPER_SNAKE_CASE'),
    label: text(raw.label, `${path}.label`, 60),
    required: true,
  };
  if (raw.placeholder !== undefined)
    result.placeholder = text(raw.placeholder, `${path}.placeholder`);
  if (raw.default !== undefined)
    result.default = text(raw.default, `${path}.default`);
  if (raw.required !== undefined) {
    if (typeof raw.required !== 'boolean')
      fail(`${path}.required`, 'must be true or false');
    result.required = raw.required as boolean;
  }
  return result;
};

/** Validates one parsed template; throws TemplateError naming the first bad field. */
export const readTemplate = (
  slug: string,
  value: unknown,
  icons: IconLookup,
): MarketplaceTemplate => {
  if (!SLUG_PATTERN.test(slug))
    fail(slug, 'file name must be lowercase letters, digits and hyphens');
  const raw = object(value, slug, [
    'schema_version',
    'name',
    'icon',
    'category',
    'tagline',
    'description',
    'features',
    'license',
    'repository',
    'website',
    'resources',
    'inputs',
    'services',
  ]);
  if (raw.schema_version !== TEMPLATE_SCHEMA_VERSION) {
    fail(`${slug}.schema_version`, `must be ${TEMPLATE_SCHEMA_VERSION}`);
  }
  const category = text(
    raw.category,
    `${slug}.category`,
  ) as MarketplaceCategory;
  if (!MARKETPLACE_CATEGORIES.includes(category)) {
    fail(
      `${slug}.category`,
      `must be one of ${MARKETPLACE_CATEGORIES.join(', ')}`,
    );
  }
  const resources = object(raw.resources, `${slug}.resources`, [
    'cpu',
    'memory_mib',
  ]);
  const services = list(
    raw.services,
    `${slug}.services`,
    MAX_SERVICES,
    (item, path) => service(item, path, icons),
  );
  if (services.length === 0)
    fail(`${slug}.services`, 'must have at least one service');
  unique(
    services.map((s) => s.name),
    `${slug}.services`,
  );
  if (services.filter((s) => s.public).length > 1)
    fail(`${slug}.services`, 'may have one public service');
  const inputs =
    raw.inputs === undefined
      ? []
      : list(raw.inputs, `${slug}.inputs`, 20, input);
  unique(
    inputs.map((i) => i.name),
    `${slug}.inputs`,
  );
  const scope: RefScope = {
    inputs: new Set(inputs.map((i) => i.name)),
    services: new Set(services.map((s) => s.name)),
    databases: new Set(
      services.filter((s) => s.type === 'postgres').map((s) => s.name),
    ),
    hasPublic: services.some((s) => s.public),
  };
  services.forEach((s, index) => {
    const at = `${slug}.services[${index}]`;
    const values: [string, string][] = [
      ...s.env.map(({ key, value }): [string, string] => [
        `${at}.env.${key}`,
        value,
      ]),
      ...(s.command ?? []).map((value, i): [string, string] => [
        `${at}.command[${i}]`,
        value,
      ]),
    ];
    for (const [path, value] of values) {
      const problem = checkRefs(value, scope);
      if (problem) fail(path, problem);
    }
  });

  return {
    slug,
    name: text(raw.name, `${slug}.name`, 60),
    icon: icon(raw.icon, `${slug}.icon`, icons),
    category,
    tagline: text(raw.tagline, `${slug}.tagline`, 120),
    description: text(raw.description, `${slug}.description`, 2000),
    features: list(raw.features, `${slug}.features`, 12, (item, path) =>
      text(item, path, 120),
    ),
    license: text(raw.license, `${slug}.license`, 60),
    repository: httpsUrl(raw.repository, `${slug}.repository`),
    website: httpsUrl(raw.website, `${slug}.website`),
    resources: {
      cpu: number(resources.cpu, `${slug}.resources.cpu`, 0.1, 64, false),
      memory_mib: number(
        resources.memory_mib,
        `${slug}.resources.memory_mib`,
        64,
        262144,
      ),
    },
    inputs,
    services,
  };
};
