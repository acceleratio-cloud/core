import { Banner } from 'fumadocs-ui/components/banner';
import { gitConfig } from '@/lib/shared';

type Release = { tag_name: string; html_url: string };

/** The latest stable release, read once at build time. */
const latestRelease = async (): Promise<Release | null> => {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${gitConfig.user}/${gitConfig.repo}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } },
    );
    return response.ok ? ((await response.json()) as Release) : null;
  } catch {
    // No network at build time: build without the banner.
    return null;
  }
};

/** "Acceleratio v0.3.1 is out | Release notes", as on the landing page. */
export const ReleaseBanner = async () => {
  const release = await latestRelease();
  if (!release) return null;

  return (
    // The id carries the version, so a dismissed banner comes back for the next release.
    <Banner id={`release-${release.tag_name}`} className="bg-fd-card text-sm">
      <span className="text-fd-muted-foreground">
        Acceleratio {release.tag_name} is out
      </span>
      <span aria-hidden="true" className="mx-3 h-4 w-px bg-fd-border" />
      <a
        href={release.html_url}
        target="_blank"
        rel="noreferrer"
        className="font-medium text-fd-foreground hover:text-fd-primary"
      >
        Release notes →
      </a>
    </Banner>
  );
};
