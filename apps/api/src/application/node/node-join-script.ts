import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import type {
  NodeJoinRole,
  NodePreflightResult,
  NodeRequirementCheck,
} from '@acceleratio/shared';

export const MIN_CPUS = 2;
export const MIN_MEMORY_MB = 1536;
export const MIN_DISK_GB = 10;

const NODE_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
const K3S_VERSION = /^v\d+\.\d+\.\d+\+k3s\d+$/;
const JOIN_TOKEN = /^[A-Za-z0-9:_.-]{16,512}$/;
const CIDR = /^[0-9a-fA-F:.]+\/\d{1,3}$/;

/**
 * Runs the script on stdin as root: directly when logged in as root (minimal
 * images often ship without sudo), otherwise through passwordless sudo. This
 * matches the preflight's PRIVILEGED check.
 */
export const PRIVILEGED_SHELL =
  'if [ "$(id -u)" = 0 ]; then exec bash -s; else exec sudo -n bash -s; fi';

/** POSIX single-quote escaping. */
export const shellQuote = (value: string): string =>
  `'${value.replace(/'/g, `'\\''`)}'`;

/** The server a new node joins, from the installation's environment. */
export interface JoinTarget {
  url: string;
  token: string;
  version: string;
  clusterCidr?: string;
  serviceCidr?: string;
}

export const readJoinTarget = (
  env: NodeJS.ProcessEnv,
  version: string | null,
): JoinTarget => {
  const url = env.K3S_JOIN_URL?.trim();
  const token = env.K3S_JOIN_TOKEN?.trim();

  if (!url || !token) {
    throw new BadRequestException(
      'Joining servers is not configured on this installation',
    );
  }

  if (!/^https:\/\/[A-Za-z0-9.:[\]-]+$/.test(url) || !JOIN_TOKEN.test(token)) {
    throw new BadRequestException('Cluster join settings are invalid');
  }

  if (!version || !K3S_VERSION.test(version)) {
    throw new BadRequestException(
      'The cluster is not running k3s, so servers cannot be joined',
    );
  }

  const clusterCidr = env.K3S_CLUSTER_CIDR?.trim() || undefined;
  const serviceCidr = env.K3S_SERVICE_CIDR?.trim() || undefined;

  for (const cidr of [clusterCidr, serviceCidr]) {
    if (cidr !== undefined && !CIDR.test(cidr)) {
      throw new BadRequestException('Cluster join settings are invalid');
    }
  }

  return { url, token, version, clusterCidr, serviceCidr };
};

export const validateNodeName = (name: unknown): string => {
  if (typeof name !== 'string' || !NODE_NAME.test(name.trim())) {
    throw new BadRequestException(
      'Node name must be lowercase letters, digits, "-" or "."',
    );
  }

  return name.trim();
};

export const validateNodeIp = (ip: string): string => {
  if (isIP(ip) === 0) {
    throw new BadRequestException('Node IP must be an IP address');
  }

  return ip;
};

const apiHost = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

/**
 * The address k3s advertises for the node. An explicit choice must be bound to
 * one of the server's interfaces (kubelet refuses a NAT or floating IP, which
 * is often what the SSH address is); otherwise the source address the server
 * uses to reach the cluster is taken, falling back to the SSH host.
 */
export const resolveNodeIp = (
  output: string,
  requested: string | null,
  sshHost: string,
): { ip: string } | { error: string } => {
  const facts = parseFacts(output);
  const local = (facts.get('HOST_IPS') ?? '').split(/\s+/).filter(Boolean);
  const ip = requested || facts.get('ROUTE_IP') || sshHost;

  if (isIP(ip) === 0) {
    return { error: 'Node IP must be an IP address' };
  }

  if (local.length > 0 && !local.includes(ip)) {
    return {
      error: `Node IP ${ip} is not assigned to the server (it has ${local.join(', ')}). Use an address of the server itself, not a public NAT address.`,
    };
  }

  return { ip };
};

/**
 * Collects facts from the server. It never fails: every value is printed as
 * KEY=value and judged by `evaluatePreflight`. Peers are IPs of the cluster's
 * other nodes, checked on the kubelet port.
 */
export const preflightScript = (target: JoinTarget, peers: string[]): string =>
  [
    'set +e',
    'echo "OS=$(uname -s)"',
    'echo "ARCH=$(uname -m)"',
    '. /etc/os-release 2>/dev/null; echo "DISTRO=${PRETTY_NAME:-unknown}"',
    'echo "CPUS=$(nproc 2>/dev/null)"',
    `echo "MEM_MB=$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null)"`,
    `echo "DISK_GB=$(df -Pk /var 2>/dev/null | awk 'NR==2{print int($4/1048576)}')"`,
    'if [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; then echo PRIVILEGED=1; else echo PRIVILEGED=0; fi',
    'if [ -d /run/systemd/system ]; then echo SYSTEMD=1; else echo SYSTEMD=0; fi',
    'if command -v curl >/dev/null 2>&1; then echo CURL=1; else echo CURL=0; fi',
    'if [ -e /usr/local/bin/k3s ] || [ -d /var/lib/rancher/k3s ]; then echo K3S_PRESENT=1; else echo K3S_PRESENT=0; fi',
    `if ss -ltn 2>/dev/null | grep -q ':10250 '; then echo PORT_10250_BUSY=1; else echo PORT_10250_BUSY=0; fi`,
    'echo "HOST_IPS=$(hostname -I 2>/dev/null)"',
    `echo "ROUTE_IP=$(ip -4 route get ${shellQuote(apiHost(target.url))} 2>/dev/null | sed -n 's/.* src \\([0-9.]*\\).*/\\1/p' | head -1)"`,
    `echo "API_HTTP=$(curl -ks -m 5 -o /dev/null -w '%{http_code}' ${shellQuote(`${target.url}/ping`)} 2>/dev/null)"`,
    `echo "INTERNET_HTTP=$(curl -s -m 8 -o /dev/null -w '%{http_code}' https://get.k3s.io 2>/dev/null)"`,
    ...peers.map(
      (peer, index) =>
        `if timeout 3 bash -c ${shellQuote(`</dev/tcp/${peer}/10250`)} 2>/dev/null; then echo "PEER_${index}=1"; else echo "PEER_${index}=0"; fi`,
    ),
  ].join('\n');

const parseFacts = (output: string): Map<string, string> => {
  const facts = new Map<string, string>();

  for (const line of output.split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());

    if (match) {
      facts.set(match[1], match[2]);
    }
  }

  return facts;
};

export const evaluatePreflight = (
  output: string,
  peers: string[],
  role: NodeJoinRole,
): Omit<NodePreflightResult, 'host_key'> => {
  const facts = parseFacts(output);
  const number = (key: string): number => Number(facts.get(key) ?? NaN);
  const checks: NodeRequirementCheck[] = [];
  const add = (
    id: string,
    label: string,
    status: NodeRequirementCheck['status'],
    detail: string | null = null,
  ) => checks.push({ id, label, status, detail });

  const linux = facts.get('OS') === 'Linux';

  add(
    'os',
    'Linux server',
    linux ? 'pass' : 'fail',
    `${facts.get('DISTRO') ?? 'unknown'} (${facts.get('ARCH') ?? 'unknown'})`,
  );
  add(
    'systemd',
    'systemd',
    facts.get('SYSTEMD') === '1' ? 'pass' : 'fail',
    'k3s runs as a systemd service',
  );
  add(
    'privileges',
    'Root or passwordless sudo',
    facts.get('PRIVILEGED') === '1' ? 'pass' : 'fail',
  );
  add('curl', 'curl installed', facts.get('CURL') === '1' ? 'pass' : 'fail');

  const minCpus = role === 'server' ? MIN_CPUS : 1;
  const cpus = number('CPUS');

  add(
    'cpu',
    `At least ${minCpus} CPU`,
    cpus >= minCpus ? 'pass' : 'fail',
    Number.isFinite(cpus) ? `${cpus} CPU` : 'unknown',
  );

  const memory = number('MEM_MB');

  add(
    'memory',
    `At least ${MIN_MEMORY_MB} MB memory`,
    memory >= MIN_MEMORY_MB ? 'pass' : 'fail',
    Number.isFinite(memory) ? `${memory} MB` : 'unknown',
  );

  const disk = number('DISK_GB');

  add(
    'disk',
    `At least ${MIN_DISK_GB} GB free in /var`,
    disk >= MIN_DISK_GB ? 'pass' : 'fail',
    Number.isFinite(disk) ? `${disk} GB` : 'unknown',
  );
  add(
    'k3s',
    'k3s not installed yet',
    facts.get('K3S_PRESENT') === '0' ? 'pass' : 'fail',
    facts.get('K3S_PRESENT') === '1'
      ? 'The server already runs or ran k3s; uninstall it first'
      : null,
  );
  add(
    'kubelet_port',
    'Port 10250 free',
    facts.get('PORT_10250_BUSY') === '0' ? 'pass' : 'fail',
  );
  add(
    'api_server',
    'Reaches the cluster API server',
    facts.get('API_HTTP') === '200' ? 'pass' : 'fail',
    `HTTP ${facts.get('API_HTTP') || 'no answer'}`,
  );
  add(
    'internet',
    'Reaches get.k3s.io',
    facts.get('INTERNET_HTTP') === '200' ? 'pass' : 'fail',
    `HTTP ${facts.get('INTERNET_HTTP') || 'no answer'}`,
  );

  peers.forEach((peer, index) =>
    add(
      `peer_${index}`,
      `Reaches node ${peer}`,
      facts.get(`PEER_${index}`) === '1' ? 'pass' : 'warn',
      'kubelet port 10250',
    ),
  );

  return { ok: checks.every((check) => check.status !== 'fail'), checks };
};

const yamlString = (value: string): string => JSON.stringify(value);

export interface InstallOptions {
  target: JoinTarget;
  name: string;
  nodeIp: string;
  role: NodeJoinRole;
  /** Extra names for the API server certificate of a server node. */
  sans: string[];
}

/** k3s config of a joining node, matching the settings `install.sh` uses. */
export const buildJoinConfig = (options: InstallOptions): string => {
  const { target } = options;
  const lines = [
    '# Managed by Acceleratio console',
    `server: ${yamlString(target.url)}`,
    `token: ${yamlString(target.token)}`,
    `node-name: ${yamlString(options.name)}`,
    `node-ip: ${yamlString(options.nodeIp)}`,
  ];

  if (options.role === 'server') {
    lines.push(
      // Server-only: the agent binary rejects the flag and exits at start-up.
      'disable-kube-proxy: true',
      'write-kubeconfig-mode: "0600"',
      'flannel-backend: none',
      'disable-network-policy: true',
      'disable:',
      '  - local-storage',
    );

    if (target.clusterCidr) {
      lines.push(`cluster-cidr: ${yamlString(target.clusterCidr)}`);
    }

    if (target.serviceCidr) {
      lines.push(`service-cidr: ${yamlString(target.serviceCidr)}`);
    }

    lines.push('tls-san:');

    for (const san of options.sans) {
      lines.push(`  - ${yamlString(san)}`);
    }
  }

  return `${lines.join('\n')}\n`;
};

/**
 * Installs k3s at the cluster's version. The config, which carries the join
 * token, arrives on stdin as part of this script, never on a command line.
 */
export const installScript = (options: InstallOptions): string =>
  [
    'set -euo pipefail',
    'umask 077',
    'mkdir -p /etc/rancher/k3s',
    `cat >/etc/rancher/k3s/config.yaml <<'ACCELERATIO_K3S_CONFIG'`,
    buildJoinConfig(options).trimEnd(),
    'ACCELERATIO_K3S_CONFIG',
    'chmod 600 /etc/rancher/k3s/config.yaml',
    `curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=${shellQuote(options.target.version)} INSTALL_K3S_EXEC=${options.role === 'server' ? 'server' : 'agent'} sh -`,
  ].join('\n');

/** Stops k3s and removes it from the server. */
export const uninstallScript = (): string =>
  [
    'set -eu',
    'if [ -x /usr/local/bin/k3s-agent-uninstall.sh ]; then /usr/local/bin/k3s-agent-uninstall.sh',
    'elif [ -x /usr/local/bin/k3s-uninstall.sh ]; then /usr/local/bin/k3s-uninstall.sh',
    'else echo "k3s is not installed on this server"; fi',
  ].join('\n');

/** Last lines of the k3s service journal, to explain a failed start. */
export const diagnoseScript = (role: NodeJoinRole): string => {
  const unit = role === 'server' ? 'k3s' : 'k3s-agent';

  return [
    'set +e',
    `echo "--- systemctl status ${unit}"`,
    `systemctl status ${unit} --no-pager -l 2>&1 | tail -n 15`,
    `echo "--- journalctl ${unit}"`,
    // k3s prints its whole flag list on a bad flag; keep the errors only.
    `journalctl -u ${unit} --no-pager -n 200 2>&1 | grep -E 'level=(fatal|error)|" E[0-9]{4} |Failed|failed|refused|not found' | tail -n 15`,
  ].join('\n');
};
