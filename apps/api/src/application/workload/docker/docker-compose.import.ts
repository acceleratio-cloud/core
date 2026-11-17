import { BadRequestException } from '@nestjs/common';
import type {
  ComposeImportPlan,
  DockerWorkloadVolume,
  EnvVar,
  ImportedService,
  WorkloadConfig,
} from '@acceleratio/shared';
import * as jsYaml from 'js-yaml';
import { FAILSAFE_SCHEMA, load, YAMLException } from 'js-yaml';
import { parseShellArgs } from '@/common/shell-args';
import { normalizeName } from '@/common/validation';
import { normalizeDockerConfig } from './docker-workload.config';

/*
  Reads a Docker Compose file into Docker services the console then creates
  one by one. Nothing is created here. A service that cannot run as it is
  described is skipped with the reason; keys with no counterpart are listed
  per service so the user sees what did not come over.
*/

export const COMPOSE_MAX_BYTES = 512 * 1024;
export const COMPOSE_SERVICES_MAX = 50;
/**
 * GiB. Compose names no size and a volume cannot grow yet; volumes are thin,
 * so the room costs nothing until it is written.
 */
export const IMPORTED_VOLUME_GIB = 10;
export const BUILD_ONLY_REASON =
  'Builds from source; push the image to a registry or add it as a GitHub service';
export const DISABLED_REASON =
  'Turned off in the file (deploy.replicas: 0); create it by hand when it is needed';

/**
 * Scalars stay the text the file has, as compose passes them on: `1.10`,
 * `0755` and `2024-01-01` are not numbers or dates. `~`/`null` and `<<`
 * merges still resolve.
 */
// js-yaml exports `types` at runtime; @types/js-yaml leaves it out.
const { types } = jsYaml as unknown as {
  types: Record<'null' | 'merge', jsYaml.Type>;
};
const COMPOSE_SCHEMA = FAILSAFE_SCHEMA.extend({
  implicit: [types.null, types.merge],
});

/** Ports of databases and brokers: a generated HTTPS domain cannot serve them. */
const NON_HTTP_PORTS = new Set([
  1433, 3306, 4222, 5432, 5672, 6379, 9042, 11211, 27017,
]);

const HANDLED_KEYS = new Set([
  'image',
  'command',
  'entrypoint',
  'environment',
  'volumes',
  'ports',
  'deploy',
]);

type Raw = Record<string, unknown>;

const isMapping = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A string is split like a shell line, as compose does; a list is kept for
 * the Docker config check, which takes only strings.
 */
const readArgs = (value: unknown, field: string): unknown => {
  if (typeof value !== 'string') return value;
  try {
    return parseShellArgs(value);
  } catch (error) {
    throw new BadRequestException(`${field}: ${(error as Error).message}`);
  }
};

/**
 * `KEY: value` or `KEY=value`. A key without a value takes it from the
 * machine running compose, which an import cannot see, so it is left out.
 * Nested values are refused rather than turned into text: a YAML alias can
 * make one expand without bound.
 */
const readEnvironment = (value: unknown, ignored: string[]): EnvVar[] => {
  if (value === undefined || value === null) return [];
  let entries: [string, unknown][];
  if (Array.isArray(value)) {
    entries = value.map((item: unknown) => {
      if (typeof item !== 'string') {
        throw new BadRequestException('environment entries must be text');
      }
      const at = item.indexOf('=');
      return at < 0 ? [item, null] : [item.slice(0, at), item.slice(at + 1)];
    });
  } else if (isMapping(value)) {
    entries = Object.entries(value);
  } else {
    throw new BadRequestException('environment must be a list or a mapping');
  }

  return entries.flatMap(([key, item]): EnvVar[] => {
    if (item === null || item === undefined) {
      ignored.push(`environment.${key}`);
      return [];
    }
    if (typeof item !== 'string') {
      throw new BadRequestException(`environment.${key} must be text`);
    }
    return [{ key, value: item }];
  });
};

/** Named and anonymous volumes; a host path has no host to come from. */
const readVolumes = (
  value: unknown,
  ignored: string[],
): DockerWorkloadVolume[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BadRequestException('volumes must be a list');
  }

  return value.flatMap((item: unknown): DockerWorkloadVolume[] => {
    let source: unknown;
    let target: unknown;
    if (isMapping(item)) {
      if (item.type !== 'volume') {
        const what = typeof item.source === 'string' ? item.source : item.type;
        ignored.push(`volumes ${typeof what === 'string' ? what : 'entry'}`);
        return [];
      }
      ({ source, target } = item);
    } else if (typeof item === 'string') {
      // `target`, `source:target` or `source:target:mode`.
      const parts = item.split(':');
      [source, target] = parts.length === 1 ? [null, parts[0]] : parts;
    } else {
      throw new BadRequestException('volumes entries must be text or mappings');
    }
    if (typeof source === 'string' && /^[./~]/.test(source)) {
      ignored.push(`volumes ${source}`);
      return [];
    }
    return [
      {
        mount_path: target as string,
        size_gb: IMPORTED_VOLUME_GIB,
        storage_class_id: null,
      },
    ];
  });
};

/**
 * One `ports` entry: `80`, `8080:80`, `127.0.0.1:8080:80/udp`, a range (its
 * first port) or `{ target: 80, protocol: udp }`.
 */
const readPort = (entry: unknown): { port: number; protocol: string } => {
  let target: unknown;
  let protocol: unknown = 'tcp';
  if (isMapping(entry)) {
    target = entry.target;
    protocol = entry.protocol ?? 'tcp';
  } else if (typeof entry === 'string') {
    const [spec, suffix] = entry.split('/');
    target = spec.split(':').pop()!.split('-')[0];
    protocol = suffix ?? 'tcp';
  }
  if (
    typeof target !== 'string' ||
    !/^\d{1,5}$/.test(target) ||
    Number(target) < 1 ||
    Number(target) > 65535 ||
    typeof protocol !== 'string'
  ) {
    throw new BadRequestException(
      `ports: ${typeof entry === 'string' ? entry : 'an entry'} has no container port`,
    );
  }
  return { port: Number(target), protocol: protocol.toLowerCase() };
};

/**
 * The first TCP port that can serve HTTP gets the generated domain; every
 * other published port is listed as not imported.
 */
const readPublicPort = (value: unknown, ignored: string[]): number | null => {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) {
    throw new BadRequestException('ports must be a list');
  }

  let chosen: number | null = null;
  for (const entry of value) {
    const { port, protocol } = readPort(entry);
    if (chosen === null && protocol === 'tcp' && !NON_HTTP_PORTS.has(port)) {
      chosen = port;
    } else {
      ignored.push(`ports ${port}/${protocol}`);
    }
  }
  return chosen;
};

/** Every scalar is text here, so a count arrives as `"2"`. */
const readReplicas = (value: unknown): unknown =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;

const readService = (name: string, raw: unknown): ImportedService => {
  if (!isMapping(raw)) {
    throw new BadRequestException('A service must be a mapping');
  }
  if (raw.image == null && raw.build != null) {
    throw new BadRequestException(BUILD_ONLY_REASON);
  }

  const ignored = Object.keys(raw).filter((key) => !HANDLED_KEYS.has(key));
  const deploy = isMapping(raw.deploy) ? raw.deploy : {};
  const replicas = readReplicas(deploy.replicas);
  if (replicas === 0) {
    throw new BadRequestException(DISABLED_REASON);
  }
  ignored.push(
    ...Object.keys(deploy)
      .filter((key) => key !== 'replicas')
      .map((key) => `deploy.${key}`),
  );

  // The same checks a Docker service applies on create.
  const config = normalizeDockerConfig({
    docker_image: raw.image,
    entrypoint: readArgs(raw.entrypoint, 'entrypoint'),
    command: readArgs(raw.command, 'command'),
    env: readEnvironment(raw.environment, ignored),
    volumes: readVolumes(raw.volumes, ignored),
    replicas,
  } as WorkloadConfig);

  return {
    name: normalizeName(name),
    config,
    public_port: readPublicPort(raw.ports, ignored),
    ignored,
  };
};

export const planComposeImport = (payload: unknown): ComposeImportPlan => {
  const content = (payload as { content?: unknown } | null)?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new BadRequestException('Paste a compose file');
  }
  if (Buffer.byteLength(content) > COMPOSE_MAX_BYTES) {
    throw new BadRequestException(
      `The compose file must be at most ${COMPOSE_MAX_BYTES / 1024} KiB`,
    );
  }

  let file: unknown;
  try {
    file = load(content, { schema: COMPOSE_SCHEMA });
  } catch (error) {
    if (!(error instanceof YAMLException)) throw error;
    throw new BadRequestException(
      `The file is not valid YAML: ${error.reason} on line ${error.mark.line + 1}`,
    );
  }

  const services =
    isMapping(file) && isMapping(file.services) ? file.services : {};
  const names = Object.keys(services);
  if (names.length === 0) {
    throw new BadRequestException('The file has no services');
  }
  if (names.length > COMPOSE_SERVICES_MAX) {
    throw new BadRequestException(
      `Import at most ${COMPOSE_SERVICES_MAX} services at once`,
    );
  }

  const plan: ComposeImportPlan = { services: [], skipped: [] };
  for (const name of names) {
    try {
      plan.services.push(readService(name, services[name]));
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      plan.skipped.push({ name, reason: error.message });
    }
  }
  return plan;
};
