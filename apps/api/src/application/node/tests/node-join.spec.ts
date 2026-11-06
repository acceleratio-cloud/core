import { BadRequestException } from '@nestjs/common';
import {
  buildJoinConfig,
  evaluatePreflight,
  installScript,
  preflightScript,
  PRIVILEGED_SHELL,
  readJoinTarget,
  validateNodeName,
  resolveNodeIp,
} from '../node-join-script';
import { NodeJoinService } from '../node-join.service';
import { createRedactor, validateSshAccess } from '../node-ssh';
import { FakeConnector, FakeOperationStore, HOST_KEY } from './fakes';

jest.mock('@/vendor/kubernetes/kubernetes.service', () => ({
  KubernetesService: class KubernetesService {},
}));

const TOKEN = 'K10abcdef0123456789abcdef::server:0123456789abcdef';
const KEY =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nQUJDREVGR0hJSktM\n-----END OPENSSH PRIVATE KEY-----';
const env = {
  K3S_JOIN_URL: 'https://10.0.0.1:6443',
  K3S_JOIN_TOKEN: TOKEN,
  K3S_CLUSTER_CIDR: '10.42.0.0/16',
  K3S_SERVICE_CIDR: '10.43.0.0/16',
};
const target = readJoinTarget(env, 'v1.31.4+k3s1');
const passing = [
  'OS=Linux',
  'ARCH=x86_64',
  'DISTRO=Ubuntu 24.04',
  'CPUS=4',
  'MEM_MB=8000',
  'DISK_GB=80',
  'PRIVILEGED=1',
  'SYSTEMD=1',
  'CURL=1',
  'K3S_PRESENT=0',
  'PORT_10250_BUSY=0',
  'API_HTTP=200',
  'INTERNET_HTTP=200',
  'PEER_0=1',
].join('\n');

describe('join target and validation', () => {
  it('requires the installation to expose join settings', () => {
    expect(() => readJoinTarget({}, 'v1.31.4+k3s1')).toThrow(
      BadRequestException,
    );
    expect(() => readJoinTarget(env, 'v1.31.4')).toThrow(BadRequestException);
    expect(target.version).toBe('v1.31.4+k3s1');
  });

  it('validates node names and SSH access', () => {
    expect(validateNodeName('worker-1')).toBe('worker-1');
    expect(() => validateNodeName('Bad Name')).toThrow(BadRequestException);
    expect(() =>
      validateSshAccess({
        host: '127.0.0.1',
        username: 'root',
        private_key: KEY,
      }),
    ).toThrow('loopback');
    expect(() =>
      validateSshAccess({
        host: '10.0.0.5',
        username: 'root; rm',
        private_key: KEY,
      }),
    ).toThrow(BadRequestException);
    expect(
      validateSshAccess({
        host: '10.0.0.5',
        username: 'root',
        private_key: KEY,
      }).port,
    ).toBe(22);
  });

  it('redacts keys, passphrases and tokens', () => {
    const redact = createRedactor(['hunter2hunter2', KEY, TOKEN]);

    expect(
      redact(`pass hunter2hunter2 token ${TOKEN} key QUJDREVGR0hJSktM ${KEY}`),
    ).not.toMatch(/hunter2|K10abcdef|QUJDREVG/);
  });
});

describe('preflight', () => {
  it('passes a suitable server', () => {
    expect(evaluatePreflight(passing, ['10.0.0.1'], 'worker').ok).toBe(true);
  });

  it('fails on small servers, existing k3s and an unreachable API', () => {
    const result = evaluatePreflight(
      passing
        .replace('MEM_MB=8000', 'MEM_MB=512')
        .replace('K3S_PRESENT=0', 'K3S_PRESENT=1')
        .replace('API_HTTP=200', 'API_HTTP=000'),
      ['10.0.0.1'],
      'worker',
    );

    expect(result.ok).toBe(false);
    expect(
      result.checks.filter((c) => c.status === 'fail').map((c) => c.id),
    ).toEqual(['memory', 'k3s', 'api_server']);
  });

  it('only warns when another node is unreachable', () => {
    const result = evaluatePreflight(
      passing.replace('PEER_0=1', 'PEER_0=0'),
      ['10.0.0.1'],
      'worker',
    );

    expect(result.ok).toBe(true);
    expect(result.checks.at(-1)?.status).toBe('warn');
  });

  it('builds a script that probes each peer', () => {
    expect(preflightScript(target, ['10.0.0.1', '10.0.0.2'])).toContain(
      'PEER_1',
    );
  });
});

describe('install script', () => {
  const options = {
    target,
    name: 'worker-1',
    nodeIp: '10.0.0.9',
    role: 'worker' as const,
    sans: ['10.0.0.9'],
  };

  it('configures agents and servers like install.sh', () => {
    const agent = buildJoinConfig(options);

    expect(agent).toContain('server: "https://10.0.0.1:6443"');
    // The agent binary rejects disable-kube-proxy and exits at start-up.
    expect(agent).not.toContain('disable-kube-proxy');
    expect(agent).not.toContain('flannel-backend');

    const server = buildJoinConfig({ ...options, role: 'server' });

    expect(server).toContain('disable-kube-proxy: true');
    expect(server).toContain('flannel-backend: none');
    expect(server).toContain('cluster-cidr: "10.42.0.0/16"');
    expect(server).toContain('- "10.0.0.9"');
  });

  it('keeps the token off the command line', () => {
    const script = installScript(options);
    const commandLines = script
      .split('\n')
      .filter((line) => line.includes('curl'));

    expect(commandLines.join('')).not.toContain(TOKEN);
    expect(commandLines[0]).toContain("INSTALL_K3S_VERSION='v1.31.4+k3s1'");
    expect(commandLines[0]).toContain('INSTALL_K3S_EXEC=agent');
  });
});

describe('NodeJoinService', () => {
  const build = () => {
    const kubernetes = {
      coreV1: {
        listNode: jest.fn().mockResolvedValue({
          items: [
            {
              metadata: { name: 'cp' },
              status: {
                nodeInfo: { kubeletVersion: 'v1.31.4+k3s1' },
                addresses: [{ type: 'InternalIP', address: '10.0.0.1' }],
              },
            },
          ],
        }),
      },
    };
    const nodes = {
      list: jest.fn().mockResolvedValue([{ name: 'cp' }]),
      get: jest.fn().mockResolvedValue({ status: 'Ready' }),
    };
    const store = new FakeOperationStore();
    const connector = new FakeConnector();
    const service = new NodeJoinService(
      kubernetes as never,
      nodes as never,
      store as never,
      connector,
    );

    connector.outputFor = (stdin) =>
      stdin.includes('PEER_0') ? passing.split('\n') : [`log ${TOKEN} ${KEY}`];
    process.env = { ...process.env, ...env };

    return { service, store, connector, nodes };
  };

  const payload = {
    name: 'worker-1',
    role: 'worker' as const,
    ssh: {
      host: '10.0.0.9',
      username: 'root',
      private_key: KEY,
      host_key: HOST_KEY,
    },
  };

  it('joins a server and keeps secrets out of the audit log', async () => {
    const { service, store, connector } = build();

    await service.add(payload, 'admin@example.com');
    const result = await store.settled('worker-1');

    expect(result.status).toBe('succeeded');
    expect(result.actor).toBe('admin@example.com');
    expect(connector.commands).toEqual(['bash -s', PRIVILEGED_SHELL]);

    const saved = JSON.stringify(result);

    expect(saved).not.toContain(TOKEN);
    expect(saved).not.toContain('QUJDREVGR0hJSktM');
  });

  it('explains a failed install and rolls k3s back', async () => {
    const { service, store, connector } = build();
    const base = connector.outputFor!;

    connector.outputFor = (stdin) =>
      stdin.includes('journalctl') ? ['level=fatal msg="boom"'] : base(stdin);
    // The installer (third script) fails; diagnose and rollback run after it.
    const run = connector.connect.bind(connector);

    connector.connect = async (access) => {
      const session = await run(access);

      return {
        ...session,
        run: async (command, options) => {
          const code = await session.run(command, options);

          return options?.stdin?.includes('k3s.io') ? 1 : code;
        },
      };
    };

    await service.add(payload, null);
    const result = await store.settled('worker-1');

    expect(result.status).toBe('failed');
    expect(result.message).toContain('see the log above');
    expect(connector.stdin.some((s) => s.includes('journalctl'))).toBe(true);
    expect(connector.stdin.some((s) => s.includes('k3s-agent-uninstall'))).toBe(
      true,
    );
  });

  it('stops before installing when requirements fail', async () => {
    const { service, store, connector } = build();

    connector.outputFor = (stdin) =>
      stdin.includes('PEER_0')
        ? passing.replace('CPUS=4', 'CPUS=0').split('\n')
        : [];

    await service.add(payload, null);
    const result = await store.settled('worker-1');

    expect(result.status).toBe('failed');
    expect(connector.commands).toEqual(['bash -s']);
  });

  it('refuses an existing node name and a concurrent join', async () => {
    const { service } = build();

    await expect(service.add({ ...payload, name: 'cp' }, null)).rejects.toThrow(
      'already exists',
    );
    await service.add(payload, null);
    await expect(service.add(payload, null)).rejects.toThrow(
      'Another operation',
    );
  });

  it('returns the presented host key from preflight', async () => {
    const { service } = build();
    const ssh = { ...payload.ssh, host_key: undefined };

    await expect(service.preflight({ ssh })).resolves.toMatchObject({
      ok: true,
      host_key: HOST_KEY,
    });
  });

  it('refuses to add a server without the checked host key', async () => {
    const { service, connector } = build();
    const ssh = { ...payload.ssh, host_key: undefined };

    await expect(service.add({ ...payload, ssh }, null)).rejects.toThrow(
      'host key is required',
    );
    expect(connector.commands).toEqual([]);
  });

  it('sends nothing to a server presenting another host key', async () => {
    const { service, store, connector } = build();

    connector.hostKey = `SHA256:${'B'.repeat(43)}`;

    await service.add(payload, null);
    const result = await store.settled('worker-1');

    expect(result.status).toBe('failed');
    expect(result.message).toContain('does not match');
    expect(connector.commands).toEqual([]);
  });

  it('reports an SSH connection failure without the key', async () => {
    const { service, connector } = build();

    connector.failConnect = true;

    await expect(service.preflight(payload)).rejects.toThrow(
      'Cannot connect over SSH',
    );
  });
});

describe('resolveNodeIp', () => {
  const facts = 'HOST_IPS=192.168.0.88 10.42.1.23\nROUTE_IP=192.168.0.88';

  it('uses the address the server reaches the cluster from', () => {
    expect(resolveNodeIp(facts, null, '82.115.42.78')).toEqual({
      ip: '192.168.0.88',
    });
  });

  it('rejects an address that is not on the server (NAT or public IP)', () => {
    const result = resolveNodeIp(facts, '82.115.42.78', '82.115.42.78');

    expect(result).toHaveProperty('error');
    expect(JSON.stringify(result)).toContain('is not assigned to the server');
  });
});
