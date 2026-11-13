import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { LogoGlyph } from '@/components/logo';
import { getPageImageUrl, siteUrl } from '@/lib/shared';

export const revalidate = false;

/** A Google font as TTF for the image renderer, which cannot read woff2. Null without network. */
const loadFont = async (family: string, weight: number): Promise<ArrayBuffer | null> => {
  try {
    const css = await (
      await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}`)
    ).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
};

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  // Funnel Display is not used here: the image renderer draws some of its glyphs wrong ("GitHub" as "GitHu.b").
  const [regular, semibold] = await Promise.all([
    loadFont('Hanken Grotesk', 500),
    loadFont('Hanken Grotesk', 600),
  ]);
  const fonts = [
    regular && { name: 'Hanken Grotesk', data: regular, weight: 500 as const },
    semibold && { name: 'Hanken Grotesk', data: semibold, weight: 600 as const },
  ].filter((font) => !!font);
  // The sidebar section the page belongs to, such as "Workloads", above the title.
  const section =
    page.slugs.length > 1
      ? source
          .getPageTree()
          .children.find((node) => node.type === 'folder' && node.index?.url === `/${page.slugs[0]}`)?.name
      : null;

  return new ImageResponse(
    (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          padding: '72px 80px',
          backgroundColor: '#070707',
          backgroundImage: 'radial-gradient(circle at 85% 0%, #1a2a3a 0%, #070707 55%)',
          color: '#f2f2f2',
          fontFamily: 'Hanken Grotesk',
          borderBottom: '8px solid #52a9fe',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 34, fontWeight: 500 }}>
          <LogoGlyph width={41} height={38} />
          <span>Acceleratio</span>
          <span
            style={{
              marginLeft: 6,
              padding: '4px 16px',
              border: '2px solid #3a3a3a',
              borderRadius: 999,
              fontSize: 22,
              color: '#b7b7b7',
            }}
          >
            Docs
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 'auto' }}>
          {section ? <span style={{ fontSize: 30, color: '#52a9fe', marginBottom: 12 }}>{section}</span> : null}
          <span style={{ fontSize: 84, fontWeight: 600, letterSpacing: '-2px', lineHeight: 1.05 }}>
            {page.data.title}
          </span>
          {page.data.description ? (
            <span style={{ fontSize: 36, color: '#b7b7b7', marginTop: 20, lineHeight: 1.3 }}>
              {page.data.description}
            </span>
          ) : null}
        </div>
        <span style={{ marginTop: 48, fontSize: 24, color: '#898989' }}>{siteUrl.replace('https://', '')}</span>
      </div>
    ),
    { width: 1200, height: 630, fonts },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }));
}
