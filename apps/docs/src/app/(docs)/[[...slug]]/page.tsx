import { source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  PageLastUpdate,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { Feedback } from '@/components/feedback';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import { getPageImageUrl, getPageMarkdownUrl, gitConfig } from '@/lib/shared';

export default async function Page(props: PageProps<'/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${encodeURI(page.path)}`}
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
      <Feedback title={page.data.title} url={page.url} />
      {page.data.lastModified ? <PageLastUpdate date={page.data.lastModified} /> : null}
    </DocsPage>
  );
}

// Docs live at the site root, so unknown paths (favicon.ico, old /docs URLs) must 404, not render.
export const dynamicParams = false;

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const image = getPageImageUrl(page).url;
  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: page.url },
    openGraph: {
      type: 'article',
      url: page.url,
      title: page.data.title,
      description: page.data.description,
      siteName: 'Acceleratio Docs',
      images: { url: image, width: 1200, height: 630 },
      ...(page.data.lastModified ? { modifiedTime: page.data.lastModified.toISOString() } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: image,
    },
  };
}
