import Github from '@thesvg/react/github';

/** GitHub's mark from thesvg; the mono variant follows the text colour. */
export const GithubIcon = ({ className }: { className?: string }) => (
  <Github variant="mono" aria-hidden="true" className={className} />
);
