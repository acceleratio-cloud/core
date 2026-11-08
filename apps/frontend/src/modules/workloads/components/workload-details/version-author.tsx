import type { WorkloadVersionAuthor } from '@acceleratio/shared';
import { Avatar, AvatarFallback } from '@/shared/components/ui/avatar';
import { GithubIcon } from '@/shared/icons/github-icon';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

/**
 * Who applied a version or started a build, inline in a line of text. A
 * console account shows its avatar; a GitHub account that pushed has none
 * here, so it shows the GitHub mark and links to its profile. `link={false}`
 * inside a button, where a link cannot go.
 */
export const VersionAuthor = ({
  author,
  link = true,
}: {
  author: WorkloadVersionAuthor;
  link?: boolean;
}) =>
  author.github_login && !link ? (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={`${author.github_login} on GitHub`}
    >
      <GithubIcon className="size-3.5" />
      {author.github_login}
    </span>
  ) : author.github_login ? (
    <a
      href={`https://github.com/${author.github_login}`}
      target="_blank"
      rel="noreferrer"
      title={`${author.github_login} on GitHub`}
      className="inline-flex items-center gap-1 align-middle text-fg-secondary underline-offset-2 hover:underline focus-visible:underline"
    >
      <GithubIcon className="size-3.5" />
      {author.github_login}
    </a>
  ) : (
    <span
      className="inline-flex items-center gap-1 align-middle"
      title={author.email}
    >
      <Avatar className="size-4 border-0">
        <AvatarFallback className="text-[8px]">
          {initials(author.name)}
        </AvatarFallback>
      </Avatar>
      {author.name}
    </span>
  );
