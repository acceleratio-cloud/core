import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUpdateScripts } from '../platform-update.manifests';
import { parseReportedStatus } from '../platform-update.status';

/**
 * Runs scripts/runner.sh against stubs: `curl` copies files from a fake
 * release, `k3s` captures the published ConfigMap and update.sh is a script
 * that reports stages and exits as told.
 */

const write = (path: string, content: string, mode = 0o755) => {
  writeFileSync(path, content);
  chmodSync(path, mode);
};

const sha256 = (content: string) =>
  createHash('sha256').update(content).digest('hex');

const K3S_STUB = `#!/usr/bin/env bash
case "$*" in
  *"create configmap"*)
    for arg in "$@"; do
      case "$arg" in
        --from-file=status=*) cp "\${arg#--from-file=status=}" "$STUB_OUT/status" ;;
        --from-file=log=*) cp "\${arg#--from-file=log=}" "$STUB_OUT/log" ;;
      esac
    done
    echo "kind: ConfigMap"
    ;;
  *apply*) cat >/dev/null ;;
esac
`;

const CURL_STUB = `#!/usr/bin/env bash
out=""; url=""
while (($#)); do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
src="$STUB_RELEASE/\${url##*/}"
[ -f "$src" ] || exit 22
cp "$src" "$out"
`;

/** A stand-in for update.sh: FAKE_STAGES is reported in order, then FAKE_RC. */
const FAKE_UPDATE = `#!/usr/bin/env bash
echo "update.sh args: $*"
for stage in $FAKE_STAGES; do
  echo "$stage" >"$ACCELERATIO_UPDATE_STAGE_FILE"
  echo "stage $stage"
done
if [ "\${FAKE_RC:-0}" != 0 ]; then
  echo "[10:00:00] ERROR: \${FAKE_ERROR:-boom}" >&2
fi
exit "\${FAKE_RC:-0}"
`;

const INSTALL = '#!/usr/bin/env bash\n# Acceleratio installer.\n';

interface RunOptions {
  stages: string;
  rc?: number;
  error?: string;
  updateSha256?: string;
  installEnv?: boolean;
}

describe('platform update runner', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'platform-update-runner-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const run = (options: RunOptions) => {
    const bin = join(root, 'bin');
    const release = join(root, 'release');
    const out = join(root, 'out');
    const configDir = join(root, 'etc');
    const work = join(root, 'updates', 'id-1');

    for (const dir of [bin, release, out, configDir, work]) {
      mkdirSync(dir, { recursive: true });
    }

    write(join(bin, 'k3s'), K3S_STUB);
    write(join(bin, 'curl'), CURL_STUB);
    write(join(release, 'update.sh'), FAKE_UPDATE);
    write(join(release, 'install.sh'), INSTALL);
    writeFileSync(join(work, 'run.sh'), readUpdateScripts().runner);

    if (options.installEnv) {
      writeFileSync(
        join(configDir, 'install.env'),
        'ACCELERATIO_PUBLIC_HOST=x\n',
      );
    }

    const result = spawnSync('bash', [join(work, 'run.sh')], {
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        UPDATE_ID: 'id-1',
        CONFIG_DIR: configDir,
        TARGET_VERSION: '0.1.7',
        RELEASE_URL:
          'https://github.com/acceleratio-cloud/core/releases/download/v0.1.7',
        UPDATE_SHA256: options.updateSha256 ?? sha256(FAKE_UPDATE),
        INSTALL_SHA256: sha256(INSTALL),
        STATUS_NAMESPACE: 'acceleratio',
        STATUS_CONFIGMAP: 'platform-update-id1',
        STUB_OUT: out,
        STUB_RELEASE: release,
        FAKE_STAGES: options.stages,
        FAKE_RC: String(options.rc ?? 0),
        FAKE_ERROR: options.error ?? '',
      },
    });

    return {
      exitCode: result.status,
      status: parseReportedStatus(readFileSync(join(out, 'status'), 'utf8')),
      log: readFileSync(join(out, 'log'), 'utf8'),
    };
  };

  it('verifies the release, runs update.sh and reports success', () => {
    const result = run({
      stages: 'prepare backup install verify cleanup',
      installEnv: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.status).toMatchObject({
      phase: 'succeeded',
      stage: 'done',
      exitCode: 0,
      message: 'Acceleratio 0.1.7 is installed and healthy.',
    });
    expect(result.log).toContain('update.sh: sha256');
    expect(result.log).toContain('install.sh: sha256');
    expect(result.log).toMatch(
      /update\.sh args: --yes --sha256 [0-9a-f]{64} --config .*install\.env/,
    );
  });

  it('stops before running anything when a checksum does not match', () => {
    const result = run({ stages: 'prepare', updateSha256: 'f'.repeat(64) });

    expect(result.status.phase).toBe('failed');
    expect(result.status.stage).toBe('download');
    expect(result.status.message).toContain(
      'update.sh does not match the checksum',
    );
    expect(result.status.message).toContain('Nothing was changed.');
    expect(result.log).not.toContain('update.sh args');
  });

  it('reports a rollback done by update.sh', () => {
    const result = run({
      stages: 'prepare backup install rollback rolled_back',
      rc: 1,
      error: 'The API did not become ready.',
    });

    expect(result.status).toMatchObject({
      phase: 'rolled_back',
      stage: 'rollback',
      exitCode: 1,
    });
    expect(result.status.message).toContain('previous version was restored');
    expect(result.status.message).toContain(
      'Cause: The API did not become ready.',
    );
  });

  it('reports a failed rollback as a failure that needs attention', () => {
    const result = run({
      stages: 'prepare backup install rollback rollback_failed',
      rc: 1,
    });

    expect(result.status.phase).toBe('failed');
    expect(result.status.message).toContain('rollback did not fully succeed');
  });

  it('says nothing changed when update.sh stops during preparation', () => {
    const result = run({
      stages: 'prepare',
      rc: 1,
      error:
        'Configuration differs from the running installation: API node port',
    });

    expect(result.status).toMatchObject({ phase: 'failed', stage: 'prepare' });
    expect(result.status.message).toBe(
      'The update stopped before changing anything. Configuration differs from the running installation: API node port',
    );
  });

  it('treats an installation that is already current as a success', () => {
    const result = run({ stages: 'prepare up_to_date' });

    expect(result.status).toMatchObject({ phase: 'succeeded', stage: 'done' });
    expect(result.status.message).toContain(
      'already runs the versions of 0.1.7',
    );
  });
});
