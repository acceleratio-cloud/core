import { source } from '@/lib/source';
import { DocsLayout } from '@/components/ai/layout';
import { baseOptions } from '@/lib/layout.shared';
import { ReleaseBanner } from '@/components/release-banner';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <ReleaseBanner />
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </>
  );
}
