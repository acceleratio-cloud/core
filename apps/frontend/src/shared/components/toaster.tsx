'use client';

import { Toaster as SileoToaster } from 'sileo';

/**
 * App-wide toast viewport. sileo ships without a "use client" directive, so it
 * is mounted through this wrapper. Defaults live here: bottom-left keeps toasts
 * clear of the service inspector on the project canvas, and the console is
 * dark-only, so the theme is pinned instead of following the OS.
 */
export const Toaster = () => (
  <SileoToaster
    position="bottom-left"
    theme="dark"
    options={{ duration: 4000, roundness: 10 }}
  />
);
