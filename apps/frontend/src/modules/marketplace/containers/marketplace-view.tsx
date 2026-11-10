'use client';

import { useDeferredValue, useState } from 'react';
import { Search } from 'lucide-react';
// Types only: the console cannot import runtime values from @acceleratio/shared.
import type {
  MarketplaceApp,
  MarketplaceCategory as Category,
} from '@acceleratio/shared';

import { Input } from '@/shared/components/ui/input';
import { AppCard } from '../components/app-card';

const FILTER =
  'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-surface-raised aria-pressed:text-foreground aria-pressed:shadow-key-soft';

/** The catalog: search, a category row and one card per app. */
export const MarketplaceView = ({ apps: all }: { apps: MarketplaceApp[] }) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | null>(null);
  const needle = useDeferredValue(query.trim().toLowerCase());

  const categories = [...new Set(all.map((app) => app.category))].sort();
  const apps = all.filter(
    (app) =>
      (!category || app.category === category) &&
      (!needle ||
        `${app.name} ${app.tagline} ${app.category}`
          .toLowerCase()
          .includes(needle)),
  );

  const count = (value: Category | null) =>
    value ? all.filter((app) => app.category === value).length : all.length;

  return (
    <div className="mx-auto w-full max-w-8xl px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl leading-none font-medium tracking-tight text-foreground">
            Marketplace
          </h1>
          <p className="mt-2.5 text-sm text-muted-foreground">
            Deploy open-source apps into a project. They run on your servers,
            with their own volumes and databases.
          </p>
        </div>
        <label className="relative block w-full sm:w-72">
          <span className="sr-only">Search apps</span>
          <Search
            aria-hidden="true"
            strokeWidth={1.75}
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search apps"
            className="pl-8"
          />
        </label>
      </div>

      <div
        role="group"
        aria-label="Category"
        className="mt-6 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
      >
        {[null, ...categories].map((value) => (
          <button
            key={value ?? 'all'}
            type="button"
            aria-pressed={category === value}
            onClick={() => setCategory(value)}
            className={FILTER}
          >
            {value ?? 'All apps'}
            <span className="text-xs text-fg-tertiary tabular-nums">
              {count(value)}
            </span>
          </button>
        ))}
      </div>

      {apps.length > 0 ? (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {apps.map((app) => (
            <li key={app.slug}>
              <AppCard app={app} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm font-medium text-foreground">
            No apps match “{query.trim()}”
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Try another name, or clear the category filter.
          </p>
        </div>
      )}
    </div>
  );
};
