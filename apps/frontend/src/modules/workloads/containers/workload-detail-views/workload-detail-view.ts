import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export type WorkloadDetailTab = {
  id: string;
  label: string;
  icon: LucideIcon;
  content: ReactNode;
};

/**
 * Everything the inspector shell needs to present one workload. Each
 * workload type supplies its own view; the shell stays type-agnostic.
 */
export type WorkloadDetailView = {
  /** Subtitle under the name, e.g. "Docker service". */
  kindLabel: string;
  icon: ReactNode;
  /** Rendered in order; the first tab is selected by default. */
  tabs: WorkloadDetailTab[];
  /** Header controls. Types may bring their own set of lifecycle actions. */
  headerActions: ReactNode;
};
