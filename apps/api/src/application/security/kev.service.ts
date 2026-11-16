import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

export const DEFAULT_KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';
const REFRESH_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
const CVE = /^CVE-\d{4}-\d{4,}$/;

/** CVE ids from the catalogue's JSON; anything else in it is ignored. */
export const parseKev = (body: unknown): Set<string> => {
  const items = (body as { vulnerabilities?: unknown } | null)?.vulnerabilities;

  return new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => (item as { cveID?: unknown } | null)?.cveID)
      .filter((id): id is string => typeof id === 'string' && CVE.test(id)),
  );
};

/**
 * CISA's catalogue of vulnerabilities exploited in the wild (KEV), loaded at
 * start and once a day from `KEV_URL`. Without it nothing is marked as
 * exploited and recommendations rank by severity alone.
 */
@Injectable()
export class KevService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KevService.name);
  private ids = new Set<string>();
  private timer?: ReturnType<typeof setTimeout>;

  onApplicationBootstrap(): void {
    void this.refresh();
  }

  onApplicationShutdown(): void {
    clearTimeout(this.timer);
  }

  isExploited(id: string): boolean {
    return this.ids.has(id);
  }

  private async refresh(): Promise<void> {
    let next = REFRESH_MS;

    try {
      const response = await fetch(
        process.env.KEV_URL?.trim() || DEFAULT_KEV_URL,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const ids = parseKev(await response.json());

      if (ids.size === 0) {
        throw new Error('the catalogue lists no CVE');
      }

      this.ids = ids;
    } catch (error) {
      // The last good list stays; try again sooner.
      next = RETRY_MS;
      this.logger.warn(
        `Could not load the exploited vulnerabilities catalogue: ${(error as Error).message}`,
      );
    } finally {
      this.timer = setTimeout(() => void this.refresh(), next);
    }
  }
}
