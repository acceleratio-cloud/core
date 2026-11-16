import type { Vulnerability } from '@acceleratio/shared';
import {
  assessService,
  isMovingTag,
  sortRecommendations,
  type ServiceFacts,
} from '../recommendations';

const vuln = (
  severity: Vulnerability['severity'],
  fixed: string | null,
  kind: Vulnerability['kind'] = 'os',
  name = `pkg-${severity}`,
): Vulnerability => ({
  id: `CVE-${name}-${severity}`,
  severity,
  package: name,
  installed_version: '1.0',
  fixed_version: fixed,
  title: null,
  kind,
  ecosystem: null,
});

const facts = (overrides: Partial<ServiceFacts>): ServiceFacts => ({
  workload_id: 'w1',
  type: 'docker',
  public: false,
  builder: null,
  open_to_everyone: false,
  images: [],
  ...overrides,
});

describe('assessService', () => {
  it('makes a fixable critical on a public image urgent', () => {
    const { service, recommendations } = assessService(
      facts({
        public: true,
        images: [
          {
            image: 'nginx:1.25',
            managed: false,
            vulnerabilities: [vuln('critical', '2.0'), vuln('low', null)],
          },
        ],
      }),
    );

    expect(service).toMatchObject({ status: 'action', waiting: 1 });
    expect(recommendations).toEqual([
      expect.objectContaining({
        id: 'image_update:w1',
        kind: 'image_update',
        level: 'urgent',
        image: 'nginx:1.25',
        packages: [
          {
            name: 'pkg-critical',
            installed_version: '1.0',
            fixed_version: '2.0',
          },
        ],
      }),
    ]);
    expect(recommendations[0].fixes?.critical).toBe(1);
  });

  it('makes a fix for an exploited finding urgent even when internal', () => {
    const { service, recommendations } = assessService(
      facts({
        images: [
          {
            image: 'redis:7',
            managed: false,
            vulnerabilities: [{ ...vuln('medium', '2.0'), exploited: true }],
          },
        ],
      }),
    );

    expect(service.status).toBe('action');
    expect(recommendations[0]).toMatchObject({
      level: 'urgent',
      exploited: 1,
    });

    const listed = assessService(
      facts({
        images: [
          {
            image: 'redis:7',
            managed: false,
            vulnerabilities: [
              vuln('critical', '2.0', 'os', 'openssl'),
              { ...vuln('low', '1.1', 'os', 'brotli'), exploited: true },
            ],
          },
        ],
      }),
    );
    expect(listed.recommendations[0].packages.map((item) => item.name)).toEqual(
      ['brotli', 'openssl'],
    );
  });

  it('names the release to move to and what it closes', () => {
    const current = [
      vuln('critical', '2.0', 'os', 'openssl'),
      vuln('high', null, 'os', 'zlib'),
      vuln('medium', '3.1', 'os', 'curl'),
    ];
    const image = (release: ServiceFacts['images'][number]['release']) =>
      assessService(
        facts({
          images: [
            {
              image: 'acme/api:1.2.0',
              managed: false,
              vulnerabilities: current,
              release,
            },
          ],
        }),
      );

    const found = image({
      status: 'found',
      tag: '1.4.1',
      image: 'acme/api:1.4.1',
      vulnerabilities: [current[2]],
    });
    const [update] = found.recommendations;
    expect(update).toMatchObject({
      kind: 'image_update',
      level: 'recommended',
    });
    expect(update.update).toMatchObject({
      tag: '1.4.1',
      image: 'acme/api:1.4.1',
    });
    expect(update.update?.remaining).toMatchObject({ medium: 1, critical: 0 });
    expect(update.fixes).toMatchObject({ critical: 1, high: 1, medium: 0 });
    // curl stays after the update: it waits for a later release.
    expect(found.service.waiting).toBe(1);

    expect(
      image({
        status: 'found',
        tag: '1.4.1',
        image: 'acme/api:1.4.1',
        vulnerabilities: null,
      }).recommendations[0].update,
    ).toEqual({ tag: '1.4.1', image: 'acme/api:1.4.1', remaining: null });
  });

  it('waits when there is no newer release, or it fixes nothing', () => {
    const current = [vuln('critical', '2.0')];
    const run = (release: ServiceFacts['images'][number]['release']) =>
      assessService(
        facts({
          images: [
            {
              image: 'acme/api:1.2.0',
              managed: false,
              vulnerabilities: current,
              release,
            },
          ],
        }),
      );

    for (const result of [
      run({ status: 'none' }),
      run({
        status: 'found',
        tag: '1.3.0',
        image: 'acme/api:1.3.0',
        vulnerabilities: current,
      }),
    ]) {
      expect(result.recommendations).toEqual([]);
      expect(result.service).toMatchObject({ status: 'waiting', waiting: 1 });
    }
  });

  it('keeps the same finding on an internal service recommended', () => {
    const { service, recommendations } = assessService(
      facts({
        images: [
          {
            image: 'redis:7',
            managed: false,
            vulnerabilities: [vuln('critical', '2.0')],
          },
        ],
      }),
    );

    expect(service.status).toBe('update');
    expect(recommendations[0].level).toBe('recommended');
  });

  it('splits a GitHub image into dependencies and the base image', () => {
    const image = {
      image: 'registry.acceleratio.internal/p/w@sha256:x',
      managed: false,
      vulnerabilities: [
        vuln('high', '4.21.2', 'library', 'express'),
        vuln('high', '2.36-3', 'os', 'libc6'),
      ],
    };

    const railpack = assessService(
      facts({ type: 'github', builder: 'railpack', images: [image] }),
    );
    expect(railpack.recommendations.map((item) => item.kind)).toEqual([
      'dependencies',
    ]);
    expect(railpack.service.platform_fixable).toBe(1);

    const dockerfile = assessService(
      facts({ type: 'github', builder: 'dockerfile', images: [image] }),
    );
    expect(dockerfile.recommendations.map((item) => item.kind)).toEqual([
      'dependencies',
      'base_image',
    ]);
    expect(dockerfile.service.platform_fixable).toBe(0);
  });

  it('leaves platform images and unfixed findings to others', () => {
    const platform = assessService(
      facts({
        type: 'postgres',
        images: [
          {
            image: 'ghcr.io/cloudnative-pg/postgresql:17',
            managed: true,
            vulnerabilities: [vuln('critical', '2.0')],
          },
        ],
      }),
    );
    expect(platform.service).toMatchObject({
      status: 'platform',
      platform_fixable: 1,
    });
    expect(platform.recommendations).toEqual([]);

    expect(
      assessService(
        facts({
          images: [
            {
              image: 'redis:7',
              managed: false,
              vulnerabilities: [vuln('high', null)],
            },
          ],
        }),
      ).service.status,
    ).toBe('waiting');
  });

  it('flags an open database and a moving tag', () => {
    const database = assessService(
      facts({ type: 'postgres', open_to_everyone: true, public: true }),
    );
    expect(database.recommendations).toEqual([
      expect.objectContaining({ kind: 'database_exposed', level: 'urgent' }),
    ]);
    expect(database.service.status).toBe('action');

    const moving = assessService(
      facts({
        images: [{ image: 'acme/worker', managed: false, vulnerabilities: [] }],
      }),
    );
    expect(moving.recommendations).toEqual([
      expect.objectContaining({ kind: 'moving_tag', level: 'optional' }),
    ]);
  });

  it('says pending until every image is scanned, and ok after', () => {
    const image = { image: 'redis:7', managed: false };

    expect(
      assessService(facts({ images: [{ ...image, vulnerabilities: null }] }))
        .service.status,
    ).toBe('pending');
    expect(
      assessService(facts({ images: [{ ...image, vulnerabilities: [] }] }))
        .service.status,
    ).toBe('ok');
  });
});

describe('isMovingTag', () => {
  it('treats no tag and latest as moving', () => {
    expect(isMovingTag('nginx')).toBe(true);
    expect(isMovingTag('ghcr.io/acme/worker:latest')).toBe(true);
    expect(isMovingTag('localhost:5000/app')).toBe(true);
    expect(isMovingTag('nginx:1.27')).toBe(false);
    expect(isMovingTag('nginx@sha256:abc')).toBe(false);
  });
});

describe('sortRecommendations', () => {
  it('puts urgent first, then what closes the most critical', () => {
    const base = {
      workload_id: 'w',
      kind: 'image_update' as const,
      image: null,
      packages: [],
      exploited: 0,
      is_new: false,
      update: null,
    };
    const counts = (critical: number) => ({
      critical,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    });

    expect(
      sortRecommendations([
        { ...base, id: 'a', level: 'optional', fixes: null },
        { ...base, id: 'b', level: 'recommended', fixes: counts(1) },
        { ...base, id: 'c', level: 'recommended', fixes: counts(5) },
        { ...base, id: 'd', level: 'urgent', fixes: null },
      ]).map((item) => item.id),
    ).toEqual(['d', 'c', 'b', 'a']);
  });
});
