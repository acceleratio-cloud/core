import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Check } from 'lucide-react';

import { GithubIcon } from '@/shared/icons/github-icon';
import { Button } from '@/shared/components/ui/button';
import type { MarketplaceApp } from '@acceleratio/shared';

import { AppCard } from '../components/app-card';
import { AppIcon } from '../components/app-icon';
import { AppPreview } from '../components/app-preview';
import { formatCpu, formatMemory } from '../format';
import { DeployAppDialog } from './deploy-app-dialog';

const SECTION_TITLE = 'text-sm font-medium text-foreground';

const Detail = ({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) => (
  <div className="flex items-baseline justify-between gap-4 py-2.5 text-[13px]">
    <dt className="shrink-0 text-muted-foreground">{term}</dt>
    <dd className="min-w-0 text-right text-foreground">{children}</dd>
  </div>
);

const host = (url: string) => new URL(url).host.replace(/^www\./, '');

/** One app: what it is, what it deploys, and the deploy action. */
export const MarketplaceAppView = ({
  app,
  apps,
}: {
  app: MarketplaceApp;
  /** The whole catalog, for the related apps row. */
  apps: MarketplaceApp[];
}) => {
  const related = apps
    .filter(
      (other) => other.category === app.category && other.slug !== app.slug,
    )
    .slice(0, 3);
  const volumes = app.services.flatMap((service) =>
    (service.volumes ?? []).map((volume) => ({
      service: service.name,
      ...volume,
    })),
  );
  const publicService = app.services.find((service) => service.public);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <Link
        href="/marketplace"
        className="group inline-flex items-center gap-1 rounded-sm text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <ArrowLeft
          aria-hidden="true"
          strokeWidth={1.75}
          className="size-3.5 transition-transform motion-safe:group-hover:-translate-x-0.5"
        />
        Marketplace
      </Link>

      <header className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <AppIcon src={app.icon} className="size-16 rounded-xl" />
          <div className="min-w-0">
            <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
              {app.name}
            </h1>
            <p className="mt-2.5 text-sm text-muted-foreground">
              {app.tagline}
            </p>
            <p className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-medium text-muted-foreground">
              <span className="rounded-full border border-border px-2 py-0.5">
                {app.category}
              </span>
              <span className="rounded-full border border-border px-2 py-0.5">
                Open source · {app.license}
              </span>
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="lg"
            variant="outline"
            nativeButton={false}
            render={
              <a href={app.repository} target="_blank" rel="noreferrer" />
            }
          >
            <GithubIcon className="size-4" />
            Source
          </Button>
          <DeployAppDialog app={app} />
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="preview-title">
            <h2 id="preview-title" className={SECTION_TITLE}>
              What gets deployed
            </h2>
            <div className="mt-3">
              <AppPreview app={app} />
            </div>
          </section>

          <section aria-labelledby="about-title">
            <h2 id="about-title" className={SECTION_TITLE}>
              About {app.name}
            </h2>
            <div className="mt-3 max-w-prose space-y-3 text-sm text-muted-foreground">
              {app.description.split(/\n\s*\n/).map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </section>

          <section aria-labelledby="features-title">
            <h2 id="features-title" className={SECTION_TITLE}>
              Features
            </h2>
            <ul className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
              {app.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2 text-sm text-foreground"
                >
                  <Check
                    aria-hidden="true"
                    strokeWidth={2}
                    className="mt-0.5 size-4 shrink-0 text-status-success"
                  />
                  {feature}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-4">
          <section
            aria-labelledby="details-title"
            className="rounded-lg border border-border bg-surface-raised px-4 py-3"
          >
            <h2 id="details-title" className={SECTION_TITLE}>
              Details
            </h2>
            <dl className="mt-1 divide-y divide-border">
              <Detail term="License">{app.license}</Detail>
              <Detail term="Website">
                <a
                  href={app.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 text-brand-fg underline-offset-4 hover:underline"
                >
                  {host(app.website)}
                  <ArrowUpRight aria-hidden="true" className="size-3" />
                </a>
              </Detail>
              <Detail term="Services">{app.services.length}</Detail>
              <Detail term="Volumes">{volumes.length}</Detail>
              {publicService ? (
                <Detail term="Public port">
                  <span className="font-mono">{publicService.port}</span>
                </Detail>
              ) : (
                <Detail term="Network">Private only</Detail>
              )}
            </dl>
          </section>

          <section
            aria-labelledby="resources-title"
            className="rounded-lg border border-border bg-surface-raised px-4 py-3"
          >
            <h2 id="resources-title" className={SECTION_TITLE}>
              Recommended resources
            </h2>
            <dl className="mt-1 divide-y divide-border">
              <Detail term="CPU">{formatCpu(app.resources.cpu)}</Detail>
              <Detail term="Memory">
                {formatMemory(app.resources.memory_mib)}
              </Detail>
              {app.services
                .filter((service) => service.volumes?.length)
                .map((service) => (
                  <Detail key={service.name} term={`${service.name} disk`}>
                    {service.volumes!.reduce((sum, v) => sum + v.size_gib, 0)}{' '}
                    GiB
                  </Detail>
                ))}
            </dl>
          </section>

          <section
            aria-labelledby="images-title"
            className="rounded-lg border border-border bg-surface-raised px-4 py-3"
          >
            <h2 id="images-title" className={SECTION_TITLE}>
              Images
            </h2>
            <ul className="mt-2 space-y-1.5 pb-1">
              {app.services.map((service) => (
                <li
                  key={service.name}
                  className="truncate font-mono text-xs text-muted-foreground"
                >
                  {service.image}
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      {related.length > 0 ? (
        <section aria-labelledby="related-title" className="mt-12">
          <h2 id="related-title" className={SECTION_TITLE}>
            More in {app.category}
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((other) => (
              <li key={other.slug}>
                <AppCard app={other} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
};
