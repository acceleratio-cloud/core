import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { MarketplaceApp } from '@acceleratio/shared';
import { load } from 'js-yaml';

import { readTemplate, type MarketplaceTemplate } from './marketplace-template';

const MAX_ICON_BYTES = 32 * 1024;

/** The repository's templates/ folder: /app/templates in the image, the repo root in development. */
export const templatesDir = () =>
  process.env.MARKETPLACE_TEMPLATES_DIR?.trim() ||
  resolve(process.cwd(), '../../templates');

/**
 * Reads every template once. A broken one is logged and left out, so one bad
 * file never takes the catalog (or the API) down; the spec fails on it in CI.
 */
export const loadTemplates = (dir: string, logger?: Logger) => {
  const icons = new Map<string, string>();
  const icon = (name: string) => {
    if (!icons.has(name)) {
      let svg: Buffer;
      try {
        svg = readFileSync(join(dir, 'icons', `${name}.svg`));
      } catch {
        return undefined;
      }
      // Shown only through <img>, where an SVG cannot run scripts.
      if (
        svg.length > MAX_ICON_BYTES ||
        !/^\s*<svg[\s>]/.test(svg.toString('utf8'))
      ) {
        return undefined;
      }
      icons.set(name, `data:image/svg+xml;base64,${svg.toString('base64')}`);
    }
    return icons.get(name);
  };

  const apps: MarketplaceTemplate[] = [];
  const errors: string[] = [];
  for (const file of readdirSync(join(dir, 'apps')).sort()) {
    if (!file.endsWith('.yaml')) continue;
    try {
      const raw = load(readFileSync(join(dir, 'apps', file), 'utf8'), {
        filename: file,
      });
      apps.push(readTemplate(file.slice(0, -'.yaml'.length), raw, icon));
    } catch (error) {
      const message = `templates/apps/${file}: ${(error as Error).message}`;
      errors.push(message);
      logger?.error(message);
    }
  }
  apps.sort((a, b) => a.name.localeCompare(b.name));
  return { apps, errors };
};

@Injectable()
export class MarketplaceService implements OnModuleInit {
  private readonly logger = new Logger(MarketplaceService.name);
  private templates: MarketplaceTemplate[] = [];
  private apps: MarketplaceApp[] = [];

  onModuleInit(): void {
    const dir = templatesDir();
    try {
      this.templates = loadTemplates(dir, this.logger).apps;
      // What the console sees: env and command stay on the server.
      this.apps = this.templates.map((template) => ({
        ...template,
        services: template.services.map(
          ({ name, image, icon, port, public: isPublic, volumes }) => ({
            name,
            image,
            icon,
            port,
            public: isPublic,
            volumes,
          }),
        ),
      }));
      this.logger.log(
        `Loaded ${this.apps.length} marketplace templates from ${dir}`,
      );
    } catch (error) {
      this.logger.error(
        `No marketplace templates at ${dir}: ${(error as Error).message}`,
      );
    }
  }

  list(): MarketplaceApp[] {
    return this.apps;
  }

  /** The full template, env included; undefined for an unknown slug. */
  find(slug: string): MarketplaceTemplate | undefined {
    return this.templates.find((template) => template.slug === slug);
  }
}
