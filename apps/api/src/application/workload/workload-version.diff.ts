import type {
  WorkloadChangeImpact,
  WorkloadConfigChange,
  WorkloadDiffSection,
  WorkloadDiffSide,
  WorkloadType,
  WorkloadVersionDiff,
} from '@acceleratio/shared';

/**
 * Pure building blocks of a version comparison, shared by every workload
 * type. A type decides its sections, labels, display values and impacts;
 * these helpers only keep the output shape identical across types.
 */

/**
 * One displayed field. Absent (null) on one side means added or removed; a
 * null impact is passed when the base has nothing running, such as the first
 * deploy.
 */
export const compareField = ({
  path,
  label,
  before,
  after,
  impact = null,
}: {
  path: string;
  label: string;
  before: string | null;
  after: string | null;
  impact?: WorkloadChangeImpact | null;
}): WorkloadConfigChange | null => {
  if (before === after) {
    return null;
  }

  return {
    path,
    label,
    kind: before === null ? 'added' : after === null ? 'removed' : 'changed',
    before,
    after,
    secret: false,
    impact,
  };
};

/**
 * A secret field: values never leave the server, only whether the field was
 * added, removed or changed. `same` is the server-side value comparison.
 */
export const compareSecret = ({
  path,
  label,
  inBase,
  inTarget,
  same,
  impact = null,
}: {
  path: string;
  label: string;
  inBase: boolean;
  inTarget: boolean;
  same: boolean;
  impact?: WorkloadChangeImpact | null;
}): WorkloadConfigChange | null => {
  if (!inBase && !inTarget) {
    return null;
  }

  if (inBase && inTarget && same) {
    return null;
  }

  return {
    path,
    label,
    kind: !inBase ? 'added' : !inTarget ? 'removed' : 'changed',
    before: null,
    after: null,
    secret: true,
    impact,
  };
};

/** Drops the fields that did not change. */
export const changesOf = (
  changes: (WorkloadConfigChange | null)[],
): WorkloadConfigChange[] =>
  changes.filter((change): change is WorkloadConfigChange => change !== null);

/** Keys of both sides: base order first, then keys only the target has. */
export const unionKeys = (base: string[], target: string[]): string[] => [
  ...base,
  ...target.filter((key) => !base.includes(key)),
];

export const buildDiff = ({
  workloadId,
  type,
  base,
  target,
  sections,
  notes = [],
}: {
  workloadId: string;
  type: WorkloadType;
  base: WorkloadDiffSide;
  target: WorkloadDiffSide;
  sections: WorkloadDiffSection[];
  notes?: string[];
}): WorkloadVersionDiff => {
  const changed = sections.filter((section) => section.changes.length > 0);
  const changes = changed.flatMap((section) => section.changes);

  return {
    workload_id: workloadId,
    type,
    base,
    target,
    identical: changes.length === 0,
    sections: changed,
    restarts: changes.some((change) => change.impact !== null),
    data_loss: changes.some((change) => change.impact === 'data_loss'),
    notes,
  };
};
