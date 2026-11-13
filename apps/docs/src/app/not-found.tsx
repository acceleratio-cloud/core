import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import Link from 'next/link';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function NotFound() {
  return (
    <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
      <main className="flex flex-1 flex-col items-start justify-center gap-4 px-8 py-24 md:px-16">
        <p className="font-mono text-sm text-fd-primary">404</p>
        <h1 className="text-4xl">This page does not exist</h1>
        <p className="max-w-md text-fd-muted-foreground">
          It may have moved. Search the docs with <kbd className="font-mono">⌘K</kbd>, or start from
          the beginning.
        </p>
        <div className="flex gap-3">
          <Link
            href="/"
            className="rounded-full bg-fd-primary px-4 py-2 text-sm font-medium text-fd-primary-foreground"
          >
            Introduction
          </Link>
          <Link href="/installation" className="rounded-full border px-4 py-2 text-sm font-medium">
            Installation
          </Link>
        </div>
      </main>
    </DocsLayout>
  );
}
