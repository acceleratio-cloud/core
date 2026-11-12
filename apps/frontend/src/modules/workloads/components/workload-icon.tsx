'use client';

import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import {
  isIconUrl,
  packIcon,
} from '@/modules/workloads/utils/workload-icon-pack';

/**
 * The icon a user picked for a service: a pack logo or a remote image. A
 * remote image goes through `<img>`, never inline markup, so its scripts never
 * run; when it fails to load the type's default icon shows instead.
 */
export const WorkloadIcon = ({
  icon,
  fallback,
  className,
}: {
  icon: string | null | undefined;
  /** The type's default icon, shown when none is set or the image fails. */
  fallback: ReactNode;
  className?: string;
}) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const pack = packIcon(icon);

  if (pack) {
    return (
      <pack.Svg
        aria-hidden="true"
        {...(pack.mono && { variant: 'mono' })}
        className={className}
      />
    );
  }

  // An id this console has no logo for is not a URL: never request it.
  if (!icon || !isIconUrl(icon) || failedSrc === icon) {
    return fallback;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- remote user URL, not optimizable
    <img
      src={icon}
      alt=""
      aria-hidden="true"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailedSrc(icon)}
      className={cn('object-contain', className)}
    />
  );
};
