import { cn } from '@/lib/utils';

/** The project's own mark, in its own colours, on a tile a step lighter than its card; dark monochrome marks ship in white. */
export const AppIcon = ({
  src,
  className,
}: {
  /** An SVG data URI from the API; an <img> keeps any script in it inert. */
  src: string;
  className?: string;
}) => (
  <span
    aria-hidden="true"
    className={cn(
      'grid size-10 shrink-0 place-items-center rounded-lg border border-edge-default bg-surface-muted',
      className,
    )}
  >
    {/* eslint-disable-next-line @next/next/no-img-element -- a data URI, nothing to optimise */}
    <img src={src} alt="" className="size-[55%]" />
  </span>
);
