import type { Metadata, Viewport } from 'next';
import { Funnel_Display, Hanken_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import { Provider } from '@/components/provider';
import { siteUrl } from '@/lib/shared';
import './global.css';

// The landing page's type: Hanken Grotesk for text, Funnel Display for headings, IBM Plex Mono for code.
const sans = Hanken_Grotesk({ subsets: ['latin'], variable: '--font-hanken' });
const display = Funnel_Display({ subsets: ['latin'], variable: '--font-funnel' });
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: 'Acceleratio Docs',
  title: { default: 'Acceleratio Docs', template: '%s | Acceleratio Docs' },
  description:
    'Documentation for Acceleratio, the open-source cloud platform for servers you own.',
  keywords: ['Acceleratio', 'self-hosted', 'PaaS', 'Kubernetes', 'k3s', 'Docker', 'PostgreSQL', 'open source'],
  openGraph: { siteName: 'Acceleratio Docs', type: 'website', locale: 'en_US' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#070707',
  colorScheme: 'dark',
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`dark ${sans.variable} ${display.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
