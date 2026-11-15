/**
 * `owner/name` from what was typed or pasted: the name itself, a github.com
 * address (a branch or file page included) or an SSH clone address. Null when
 * it names no repository.
 */
export const githubRepositoryName = (value: string): string | null => {
  const match = value
    .trim()
    .match(
      /^(?:(?:https?:\/\/|ssh:\/\/git@|git@)?(?:www\.)?github\.com[/:])?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i,
    );

  return match ? `${match[1]}/${match[2]}` : null;
};
