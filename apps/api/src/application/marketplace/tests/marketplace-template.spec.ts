import { resolve } from 'node:path';

import { readTemplate, TemplateError } from '../marketplace-template';
import { loadTemplates } from '../marketplace.service';

const icons = (name: string) =>
  name === 'missing' ? undefined : `data:${name}`;

const valid = () => ({
  schema_version: 1,
  name: 'Demo',
  icon: 'demo',
  category: 'Analytics',
  tagline: 'A demo app.',
  description: 'First.\n\nSecond.',
  features: ['One'],
  license: 'MIT',
  repository: 'https://github.com/example/demo',
  website: 'https://demo.example',
  resources: { cpu: 0.5, memory_mib: 512 },
  services: [
    {
      name: 'demo',
      image: 'example/demo:1.2.3',
      icon: 'demo',
      port: 80,
      public: true,
    },
    {
      name: 'postgres',
      image: 'postgres:17.2-alpine',
      icon: 'postgres',
      volume: { path: '/data', size_gib: 5 },
    },
  ],
});

const rejects = (
  patch: (raw: ReturnType<typeof valid>) => unknown,
  message: RegExp,
) => expect(() => readTemplate('demo', patch(valid()), icons)).toThrow(message);

describe('readTemplate', () => {
  it('reads a valid template', () => {
    const app = readTemplate('demo', valid(), icons);
    expect(app.slug).toBe('demo');
    expect(app.inputs).toEqual([]);
    expect(app.services[1].volume).toEqual({ path: '/data', size_gib: 5 });
  });

  it('rejects fields the schema does not name', () => {
    rejects(
      (raw) => ({ ...raw, manifests: [] }),
      /manifests: is not a known field/,
    );
    rejects((raw) => {
      (raw.services[0] as Record<string, unknown>).privileged = true;
      return raw;
    }, /services\[0\]\.privileged: is not a known field/);
  });

  it('requires an explicit image tag other than latest', () => {
    for (const image of [
      'example/demo',
      'example/demo:latest',
      'Example/demo:1',
      'example/demo:latest@sha256:' + 'a'.repeat(64),
    ]) {
      rejects(
        (raw) => ((raw.services[0].image = image), raw),
        /image: must be an image/,
      );
    }
    expect(() =>
      readTemplate(
        'demo',
        ((raw) => (
          (raw.services[0].image =
            'ghcr.io:5000/a/b:v1@sha256:' + 'a'.repeat(64)),
          raw
        ))(valid()),
        icons,
      ),
    ).not.toThrow();
  });

  it('rejects host-escaping volume paths, bad URLs, versions and missing icons', () => {
    rejects(
      (raw) => ((raw.services[1].volume!.path = '/data/../etc'), raw),
      /volume\.path/,
    );
    rejects(
      (raw) => ((raw.services[1].volume!.path = 'data'), raw),
      /volume\.path/,
    );
    rejects(
      (raw) => ((raw.repository = 'http://github.com/x'), raw),
      /repository: must be an https URL/,
    );
    rejects(
      (raw) => ((raw.schema_version = 2), raw),
      /schema_version: must be 1/,
    );
    rejects((raw) => ((raw.icon = 'missing'), raw), /icon: has no file/);
    rejects(
      (raw) => ((raw.category = 'Games'), raw),
      /category: must be one of/,
    );
  });

  it('rejects duplicate services and two public services', () => {
    rejects(
      (raw) => ((raw.services[1].name = 'demo'), raw),
      /has "demo" twice/,
    );
    rejects((raw) => {
      Object.assign(raw.services[1], { public: true, port: 5432 });
      return raw;
    }, /may have one public service/);
  });

  it('throws TemplateError for a non-mapping', () => {
    expect(() => readTemplate('demo', 'text', icons)).toThrow(TemplateError);
  });
});

describe('bundled templates', () => {
  it('all pass the schema', () => {
    const { apps, errors } = loadTemplates(
      resolve(__dirname, '../../../../../../templates'),
    );
    expect(errors).toEqual([]);
    expect(apps.length).toBeGreaterThan(0);
  });
});
