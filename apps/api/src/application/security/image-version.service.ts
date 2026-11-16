import { Inject, Injectable, Logger } from '@nestjs/common';
import { inArray, lt, sql } from 'drizzle-orm';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import {
  OciRegistryClient,
  parseImageReference,
  type ImageReference,
} from '@/vendor/registry/oci-registry.client';
import { ImageScanService } from './image-scan.service';
import { newerTag, parseTag } from './image-versions';
import {
  imageVersionCheck,
  type ImageVersionCheckRow,
} from './schemas/image-version-check.schema';

const CHECK_AFTER_MS = 24 * 60 * 60 * 1000;
/** A failed lookup is tried again sooner. */
const RETRY_AFTER_MS = 60 * 60 * 1000;
const PRUNE_AFTER = sql`interval '7 days'`;

/** `docker.io/library/nginx:1.25`: one key per image and tag. */
export const versionKey = (reference: ImageReference): string =>
  `${reference.registry}/${reference.repository}:${reference.tag ?? ''}`;

/**
 * Finds, for an image a Docker service names by a version tag, the newest
 * release of the same line, and queues it for a scan so the console can say
 * what updating would fix. Lookups run one at a time in the background and
 * at most once a day per image; a registry that cannot be read leaves the
 * recommendation without a version.
 */
@Injectable()
export class ImageVersionService {
  private readonly logger = new Logger(ImageVersionService.name);
  private readonly queue = new Set<string>();
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly registry: OciRegistryClient,
    private readonly scans: ImageScanService,
  ) {}

  /** What is known about these images (spec names), by `versionKey`. */
  async rows(images: string[]): Promise<Map<string, ImageVersionCheckRow>> {
    const keys = images.flatMap((image) => {
      const reference = parseImageReference(image);
      return reference?.tag ? [versionKey(reference)] : [];
    });

    if (keys.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select()
      .from(imageVersionCheck)
      .where(inArray(imageVersionCheck.image, keys));

    return new Map(rows.map((row) => [row.image, row]));
  }

  /** Looks up the images that are due, in the background. */
  checkSoon(images: string[], known: Map<string, ImageVersionCheckRow>): void {
    const now = Date.now();

    for (const image of images) {
      const reference = parseImageReference(image);

      if (!reference?.tag || !parseTag(reference.tag)) {
        continue;
      }

      const row = known.get(versionKey(reference));
      const wait = row?.error ? RETRY_AFTER_MS : CHECK_AFTER_MS;

      if (!row || now - row.checked_at.getTime() > wait) {
        this.queue.add(image);
      }
    }

    void this.drain();
  }

  /** Forgets lookups of images nobody checked for a week. */
  async prune(): Promise<void> {
    await this.db
      .delete(imageVersionCheck)
      .where(lt(imageVersionCheck.checked_at, sql`now() - ${PRUNE_AFTER}`));
  }

  private async drain(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      for (const image of this.queue) {
        this.queue.delete(image);
        await this.check(image);
      }
    } finally {
      this.running = false;
    }
  }

  private async check(image: string): Promise<void> {
    const reference = parseImageReference(image);
    const version = reference?.tag ? parseTag(reference.tag) : null;

    if (!reference?.tag || !version) {
      return;
    }

    let values: Omit<ImageVersionCheckRow, 'image' | 'checked_at'>;

    try {
      const tags = await this.registry.listTags(
        reference,
        version.numbers.length > 1
          ? `${version.prefix}${version.numbers[0]}.`
          : '',
      );
      const tag = newerTag(reference.tag, tags);
      const digest = tag ? await this.registry.digestOf(reference, tag) : null;

      values = { candidate_tag: tag, candidate_digest: digest, error: null };

      if (digest) {
        await this.scans.track([
          {
            digest,
            image_id: `${reference.registry}/${reference.repository}@${digest}`,
          },
        ]);
      }
    } catch (error) {
      values = {
        candidate_tag: null,
        candidate_digest: null,
        error: (error as Error).message.slice(0, 500),
      };
      this.logger.warn(
        `Could not look up newer releases of ${image}: ${values.error}`,
      );
    }

    await this.db
      .insert(imageVersionCheck)
      .values({ image: versionKey(reference), ...values })
      .onConflictDoUpdate({
        target: imageVersionCheck.image,
        set: { ...values, checked_at: sql`now()` },
      });
  }
}
