import Railway from '@thesvg/react/railway';

/** Railway's mark from thesvg; the mono variant follows the text colour. */
export const RailwayIcon = ({ className }: { className?: string }) => (
  <Railway variant="mono" aria-hidden="true" className={className} />
);
