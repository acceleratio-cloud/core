import type { KubernetesService } from '@/vendor/kubernetes/kubernetes.service';
import {
  buildInternalDnsOverride,
  COREDNS_CUSTOM_NAME,
  COREDNS_NAME,
  DNS_RECHECK_MS,
  COREDNS_CUSTOM_NAMESPACE,
  INTERNAL_DNS_OVERRIDE_KEY,
  ProjectDnsService,
} from '../project-dns.service';

// The client-node package is ESM-only and Jest runs CommonJS.
jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const statusError = (code: number) =>
  Object.assign(new Error(`HTTP ${code}`), { code });
const notFound = () => statusError(404);

const K3S_COREFILE = `.:53 {
    kubernetes cluster.local
    import /etc/coredns/custom/*.override
    forward . /etc/resolv.conf
}`;

/** Answers for coredns-custom (by test) and k3s's own Corefile. */
const configMaps = (custom: () => Promise<unknown>) =>
  jest.fn(({ name }: { name: string }) =>
    name === COREDNS_NAME
      ? Promise.resolve({ data: { Corefile: K3S_COREFILE } })
      : custom(),
  );

const createService = () => {
  const coreV1 = {
    readNamespacedConfigMap: configMaps(() => Promise.reject(notFound())),
    createNamespacedConfigMap: jest.fn().mockResolvedValue({}),
    patchNamespacedConfigMap: jest.fn().mockResolvedValue({}),
  };
  const kubernetes = { coreV1 } as unknown as KubernetesService;

  const service = new ProjectDnsService(kubernetes);
  const warn = jest
    .spyOn(
      (service as unknown as { logger: { warn: (message: string) => void } })
        .logger,
      'warn',
    )
    .mockImplementation(() => undefined);

  return { service, coreV1, warn };
};

const customReads = (mock: jest.Mock) =>
  (mock.mock.calls as Array<[{ name: string }]>).filter(
    ([request]) => request.name === COREDNS_CUSTOM_NAME,
  ).length;

const customAnswer = (
  coreV1: { readNamespacedConfigMap: jest.Mock },
  ...answers: Array<() => Promise<unknown>>
) => {
  let call = 0;
  coreV1.readNamespacedConfigMap.mockImplementation(
    ({ name }: { name: string }) => {
      if (name === COREDNS_NAME) {
        return Promise.resolve({ data: { Corefile: K3S_COREFILE } });
      }
      const answer = answers[Math.min(call, answers.length - 1)];
      call += 1;
      return answer();
    },
  );
};

/** Applies the rewrite rule the way CoreDNS does, to check what it matches. */
const rewrite = (query: string, domain = 'cluster.local'): string | null => {
  const line = buildInternalDnsOverride(domain)
    .split('\n')
    .find((value) => value.trim().startsWith('name regex'))!;
  const [, , pattern, replacement] = line.trim().split(/\s+/);
  const match = new RegExp(pattern).exec(query);

  return match
    ? replacement.replace(/\{(\d+)\}/g, (_, index: string) => match[+index])
    : null;
};

describe('buildInternalDnsOverride', () => {
  it('maps a searched private name to the Service of the same namespace', () => {
    expect(
      rewrite(
        'postgres.internal.project-2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b.svc.cluster.local.',
      ),
    ).toBe(
      'postgres.project-2f1c9a3e-8b7d-4e6f-9a0b-1c2d3e4f5a6b.svc.cluster.local.',
    );
  });

  it('ignores names outside project namespaces and other suffixes', () => {
    expect(
      rewrite('postgres.internal.kube-system.svc.cluster.local.'),
    ).toBeNull();
    expect(rewrite('postgres.internal.')).toBeNull();
    expect(rewrite('postgres.project-a.svc.cluster.local.')).toBeNull();
    expect(rewrite('a.b.internal.project-a.svc.cluster.local.')).toBeNull();
  });

  it('follows a custom cluster domain', () => {
    expect(
      rewrite('db.internal.project-a.svc.k8s.example.', 'k8s.example'),
    ).toBe('db.project-a.svc.k8s.example.');
  });

  it('rewrites the answer back to the asked name', () => {
    expect(buildInternalDnsOverride()).toContain('answer auto');
  });
});

describe('ProjectDnsService.ensure', () => {
  it('creates coredns-custom when it is missing', async () => {
    const { service, coreV1 } = createService();
    await service.ensure();

    const [request] = coreV1.createNamespacedConfigMap.mock.calls[0] as [
      {
        namespace: string;
        body: { metadata: { name: string }; data: Record<string, string> };
      },
    ];

    expect(request.namespace).toBe(COREDNS_CUSTOM_NAMESPACE);
    expect(request.body.metadata.name).toBe(COREDNS_CUSTOM_NAME);
    expect(request.body.data).toEqual({
      [INTERNAL_DNS_OVERRIDE_KEY]: buildInternalDnsOverride(),
    });
  });

  it('adds only its own key to an existing ConfigMap', async () => {
    const { service, coreV1 } = createService();
    customAnswer(coreV1, () =>
      Promise.resolve({ data: { 'operator.server': 'example.com:53 {}' } }),
    );

    await service.ensure();

    expect(coreV1.patchNamespacedConfigMap).toHaveBeenCalledWith({
      name: COREDNS_CUSTOM_NAME,
      namespace: COREDNS_CUSTOM_NAMESPACE,
      body: [
        {
          op: 'add',
          path: `/data/${INTERNAL_DNS_OVERRIDE_KEY}`,
          value: buildInternalDnsOverride(),
        },
      ],
    });
  });

  it('does not write an up-to-date rule and trusts it for a while', async () => {
    const { service, coreV1 } = createService();
    customAnswer(coreV1, () =>
      Promise.resolve({
        data: { [INTERNAL_DNS_OVERRIDE_KEY]: buildInternalDnsOverride() },
      }),
    );

    await service.ensure();
    await service.ensure();

    expect(coreV1.patchNamespacedConfigMap).not.toHaveBeenCalled();
    expect(customReads(coreV1.readNamespacedConfigMap)).toBe(1);
  });

  it('writes the rule again once the recheck window passed', async () => {
    const { service, coreV1 } = createService();
    const now = jest.spyOn(Date, 'now');

    now.mockReturnValue(1_000);
    await service.ensure();
    // Deleted by hand meanwhile.
    now.mockReturnValue(1_000 + DNS_RECHECK_MS);
    await service.ensure();
    now.mockRestore();

    expect(coreV1.createNamespacedConfigMap).toHaveBeenCalledTimes(2);
  });

  it('warns once when the Corefile does not import the rule', async () => {
    const { service, coreV1, warn } = createService();
    coreV1.readNamespacedConfigMap.mockImplementation(
      ({ name }: { name: string }) =>
        name === COREDNS_NAME
          ? Promise.resolve({
              data: { Corefile: '.:53 { forward . 1.1.1.1 }' },
            })
          : Promise.reject(notFound()),
    );

    await service.ensure();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('will not resolve');
  });

  it('stays quiet on a k3s Corefile', async () => {
    const { service, warn } = createService();

    await service.ensure();

    expect(warn).not.toHaveBeenCalled();
  });

  it('checks again after a failure', async () => {
    const { service, coreV1 } = createService();
    customAnswer(
      coreV1,
      () => Promise.reject(statusError(500)),
      () => Promise.reject(notFound()),
    );

    await expect(service.ensure()).rejects.toBeDefined();
    await service.ensure();

    expect(coreV1.createNamespacedConfigMap).toHaveBeenCalledTimes(1);
  });
});
