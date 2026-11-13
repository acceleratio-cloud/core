import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  INSTALL_SCRIPT,
  UPDATE_SCRIPT,
  parseChecksums,
  parseGithubReleases,
} from './platform-release.parse';
import {
  platformReleaseCheck,
  type PlatformReleaseCheckRow,
  type StoredRelease,
} from './schemas/platform-update.schema';

const CHECK_ID = 1;
export const DEFAULT_RELEASE_REPOSITORY = 'acceleratio-cloud/core';
const DEFAULT_GITHUB_API = 'https://api.github.com';
/** Background check cadence; PLATFORM_UPDATE_CHECK_INTERVAL_MS=0 disables it. */
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** First background check after start, so boot is not slowed down. */
const FIRST_CHECK_DELAY_MS = 30 * 1000;
/** A manual check within this window returns the stored result. */
const MANUAL_CHECK_COOLDOWN_MS = 15 * 1000;
const REQUEST_TIMEOUT_MS = 15 * 1000;
const USER_AGENT = 'acceleratio-api (platform update check)';

export const OFFLINE_MESSAGE =
  'Could not reach GitHub to check for updates. The server may have no internet access; update over SSH with scripts/update.sh instead.';

export interface ReleaseChecksums {
  updateSha256: string;
  installSha256: string;
}

const readInterval = (): number => {
  const raw = process.env.PLATFORM_UPDATE_CHECK_INTERVAL_MS;

  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_CHECK_INTERVAL_MS;
  }

  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? value
    : DEFAULT_CHECK_INTERVAL_MS;
};

/**
 * Finds the stable releases published on GitHub, periodically and on demand,
 * and keeps the last result in the database.
 */
@Injectable()
export class PlatformReleaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PlatformReleaseService.name);
  readonly repository =
    process.env.ACCELERATIO_RELEASE_REPOSITORY?.trim() ||
    DEFAULT_RELEASE_REPOSITORY;
  private readonly githubApi = (
    process.env.ACCELERATIO_RELEASE_API?.trim() || DEFAULT_GITHUB_API
  ).replace(/\/+$/, '');
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<PlatformReleaseCheckRow> | null = null;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  onModuleInit(): void {
    const interval = readInterval();

    if (interval === 0) {
      return;
    }

    const run = () => {
      this.check().catch((error: unknown) => {
        this.logger.warn(`Release check failed: ${(error as Error).message}`);
      });
    };

    this.timer = setTimeout(() => {
      run();
      this.timer = setInterval(run, interval);
      this.timer.unref();
    }, FIRST_CHECK_DELAY_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** `github.com/owner/repo`, shown next to the result. */
  get source(): string {
    return `github.com/${this.repository}`;
  }

  async read(): Promise<PlatformReleaseCheckRow | null> {
    const [row] = await this.db.select().from(platformReleaseCheck).limit(1);
    return row ?? null;
  }

  /** A check started by a person; repeated clicks reuse a fresh result. */
  async checkNow(): Promise<PlatformReleaseCheckRow> {
    const row = await this.read();

    if (
      row?.checked_at &&
      !row.error &&
      Date.now() - row.checked_at.getTime() < MANUAL_CHECK_COOLDOWN_MS
    ) {
      return row;
    }

    return this.check();
  }

  /**
   * Asks GitHub for the releases and stores the result. A failure is stored
   * too, next to the releases found by the last successful check.
   */
  check(): Promise<PlatformReleaseCheckRow> {
    this.inFlight ??= this.runCheck().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** The stored release with this version, if the last check saw it. */
  async find(version: string): Promise<StoredRelease | null> {
    const row = await this.read();
    return row?.releases.find((release) => release.version === version) ?? null;
  }

  /** The SHA-256 of update.sh and install.sh from the release's SHA256SUMS. */
  async checksums(release: StoredRelease): Promise<ReleaseChecksums> {
    let text: string;

    try {
      const response = await fetch(release.checksums_url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      text = await response.text();
    } catch (error) {
      this.logger.warn(
        `Failed to download SHA256SUMS of ${release.tag}: ${(error as Error).message}`,
      );
      throw new BadGatewayException(
        `Could not download the checksums of ${release.version} from GitHub.`,
      );
    }

    const sums = parseChecksums(text);
    const updateSha256 = sums.get(UPDATE_SCRIPT);
    const installSha256 = sums.get(INSTALL_SCRIPT);

    if (!updateSha256 || !installSha256) {
      throw new BadGatewayException(
        `The release ${release.version} does not publish checksums for ${UPDATE_SCRIPT} and ${INSTALL_SCRIPT}.`,
      );
    }

    return { updateSha256, installSha256 };
  }

  private async runCheck(): Promise<PlatformReleaseCheckRow> {
    const checkedAt = new Date();
    let releases: StoredRelease[];

    try {
      releases = await this.fetchReleases();
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`Release check failed: ${message}`);
      return this.save({ checked_at: checkedAt, error: message });
    }

    return this.save({
      checked_at: checkedAt,
      error: null,
      releases,
      latest_version: releases[0]?.version ?? null,
    });
  }

  private async fetchReleases(): Promise<StoredRelease[]> {
    let response: Response;

    try {
      response = await fetch(
        `${this.githubApi}/repos/${this.repository}/releases?per_page=50`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': USER_AGENT,
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
    } catch {
      throw new Error(OFFLINE_MESSAGE);
    }

    if (response.status === 403 || response.status === 429) {
      throw new Error(
        'GitHub is rate limiting the update check. Try again later.',
      );
    }

    if (!response.ok) {
      throw new Error(
        `GitHub answered the update check with HTTP ${response.status}.`,
      );
    }

    return parseGithubReleases(await response.json());
  }

  private async save(
    values: Partial<
      Pick<
        PlatformReleaseCheckRow,
        'latest_version' | 'releases' | 'checked_at' | 'error'
      >
    >,
  ): Promise<PlatformReleaseCheckRow> {
    const [row] = await this.db
      .insert(platformReleaseCheck)
      .values({ id: CHECK_ID, ...values })
      .onConflictDoUpdate({
        target: platformReleaseCheck.id,
        set: { ...values, updated_at: sql`now()` },
      })
      .returning();

    return row;
  }
}
