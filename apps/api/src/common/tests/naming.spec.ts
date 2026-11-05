import {
  CONFLICT_ID_PREFIX_LENGTH,
  DEFAULT_SLUG_LENGTH,
  DNS1123_LABEL_MAX_LENGTH,
  projectNamespace,
  slugify,
  storageClassExternalName,
  workloadExternalName,
} from '../naming';

const DNS1123_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// DNS-1035 names are stricter than DNS-1123: they start with a letter. The
// generated workload name keeps that shape; Deployment and namespace names
// only need DNS-1123.
const DNS1035_LABEL = /^[a-z]([-a-z0-9]*[a-z0-9])?$/;

const expectValidLabel = (value: string) => {
  expect(value).toMatch(DNS1123_LABEL);
  expect(value.length).toBeLessThanOrEqual(DNS1123_LABEL_MAX_LENGTH);
};

const expectValidDNS1035Name = (value: string) => {
  expect(value).toMatch(DNS1035_LABEL);
  expect(value.length).toBeLessThanOrEqual(DNS1123_LABEL_MAX_LENGTH);
};

const projectId = '2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b';
const workloadId = '3f9a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8';

describe('slugify', () => {
  it('lowercases and joins words with single dashes', () => {
    expect(slugify('My API')).toBe('my-api');
    expect(slugify('  Hello---World  ')).toBe('hello-world');
  });

  it('transliterates Cyrillic', () => {
    expect(slugify('Привет, мир!')).toBe('privet-mir');
    expect(slugify('ЁЖ')).toBe('ezh');
    expect(slugify('Щука')).toBe('shchuka');
  });

  it('strips Latin diacritics', () => {
    expect(slugify('Café Délice')).toBe('cafe-delice');
  });

  it('falls back to a fixed slug when nothing usable remains', () => {
    expect(slugify('')).toBe('workload');
    expect(slugify('   ')).toBe('workload');
    expect(slugify('---')).toBe('workload');
  });

  it('keeps the result inside the DNS-1123 limit', () => {
    const slug = slugify('a'.repeat(100));

    expect(slug).toHaveLength(DNS1123_LABEL_MAX_LENGTH);
    expectValidLabel(slug);
  });
});

describe('workloadExternalName', () => {
  it('appends the first eight characters of the id', () => {
    expect(workloadExternalName('My API', workloadId)).toBe('my-api-3f9a1b2c');
  });

  it('prefixes a numeric-leading name to keep a leading letter', () => {
    expect(workloadExternalName('3d-viewer', workloadId)).toBe(
      'w-3d-viewer-3f9a1b2c',
    );
    expect(workloadExternalName('2048', workloadId)).toBe('w-2048-3f9a1b2c');
    expectValidDNS1035Name(workloadExternalName('2048', workloadId));
  });

  it('prefixes a numeric-leading slug after truncation', () => {
    const name = workloadExternalName('12345678901234567890', workloadId, 5);

    expect(name).toBe('w-12345-3f9a1b2c');
    expectValidDNS1035Name(name);
  });

  it('keeps the numeric prefix inside the 63-character limit', () => {
    const name = workloadExternalName('1'.repeat(80), workloadId, 63);

    expect(name).toBe(`w-${'1'.repeat(52)}-3f9a1b2c`);
    expect(name).toHaveLength(DNS1123_LABEL_MAX_LENGTH);
    expectValidDNS1035Name(name);
  });

  it('keeps the numeric prefix on a longer retry suffix', () => {
    const name = workloadExternalName(
      '2048',
      workloadId,
      DEFAULT_SLUG_LENGTH,
      CONFLICT_ID_PREFIX_LENGTH,
    );

    expect(name).toBe('w-2048-3f9a1b2c4d5e');
    expectValidDNS1035Name(name);
  });

  it('truncates the slug to 40 characters by default', () => {
    const name = workloadExternalName('a'.repeat(50), workloadId);

    expect(name).toBe(`${'a'.repeat(DEFAULT_SLUG_LENGTH)}-3f9a1b2c`);
    expectValidDNS1035Name(name);
  });

  it('truncates without leaving a trailing dash', () => {
    const name = workloadExternalName(`${'a'.repeat(39)}-b`, workloadId);

    expect(name).toBe(`${'a'.repeat(39)}-3f9a1b2c`);
    expectValidDNS1035Name(name);
  });

  it('accepts a shorter slug limit', () => {
    expect(workloadExternalName('My API', workloadId, 6)).toBe(
      'my-api-3f9a1b2c',
    );
  });

  it('uses a longer id prefix for a unique-constraint retry', () => {
    const name = workloadExternalName(
      'My API',
      workloadId,
      DEFAULT_SLUG_LENGTH,
      CONFLICT_ID_PREFIX_LENGTH,
    );

    expect(name).toBe('my-api-3f9a1b2c4d5e');
    expectValidDNS1035Name(name);
  });

  it('handles a Cyrillic name', () => {
    const name = workloadExternalName('Сервис заказов', workloadId);

    expect(name).toBe('servis-zakazov-3f9a1b2c');
    expectValidDNS1035Name(name);
  });

  it('falls back deterministically for an empty name or id', () => {
    expect(workloadExternalName('', workloadId)).toBe('workload-3f9a1b2c');
    expect(workloadExternalName('My API', '')).toBe('my-api-0');
    expect(workloadExternalName('!!!', '')).toBe('workload-0');
  });
});

describe('projectNamespace', () => {
  it('prefixes the project id with "project-"', () => {
    expect(projectNamespace(projectId)).toBe(`project-${projectId}`);
  });

  it('lowercases the id to stay a valid label', () => {
    const namespace = projectNamespace(projectId.toUpperCase());

    expect(namespace).toBe(`project-${projectId}`);
    expectValidLabel(namespace);
  });

  it('rejects ids that cannot form a DNS-1123 label', () => {
    expect(() => projectNamespace('not a uuid')).toThrow(
      'Project id is not a valid DNS-1123 label',
    );
  });
});

describe('storageClassExternalName', () => {
  const id = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

  it('prefixes the slug and the id', () => {
    expect(storageClassExternalName('Fast SSD', id)).toBe(
      'sc-fast-ssd-7c1d2e3f',
    );
  });

  it('uses a longer id prefix on conflict and stays a DNS label', () => {
    const name = storageClassExternalName(
      'a'.repeat(80),
      id,
      CONFLICT_ID_PREFIX_LENGTH,
    );

    expect(name).toBe(`sc-${'a'.repeat(40)}-7c1d2e3f4a5b`);
    expect(name).toMatch(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/);
    expect(name.length).toBeLessThanOrEqual(63);
  });

  it('falls back to a generic slug', () => {
    expect(storageClassExternalName('!!!', id)).toBe('sc-workload-7c1d2e3f');
  });
});
