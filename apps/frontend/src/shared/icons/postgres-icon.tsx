import Postgresql from '@thesvg/react/postgresql';

/** PostgreSQL's elephant from thesvg, in its own colours. */
export const PostgresIcon = ({ className }: { className?: string }) => (
  <Postgresql aria-hidden="true" className={className} />
);
