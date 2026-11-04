import { BadRequestException } from '@nestjs/common';
import type { WorkloadPosition } from '@acceleratio/shared';
import { eq } from 'drizzle-orm';
import type { Database } from '@/vendor/db/database.constants';
import { workload } from './schemas/workload.schema';

const POSITION_COLUMNS = 4;
const POSITION_STEP_X = 320;
const POSITION_STEP_Y = 300;

/** Default canvas layout: a four-column grid with room between the cards. */
const gridPosition = (index: number): WorkloadPosition => ({
  x: (index % POSITION_COLUMNS) * POSITION_STEP_X,
  y: Math.floor(index / POSITION_COLUMNS) * POSITION_STEP_Y,
});

const positionKey = (position: WorkloadPosition): string =>
  `${position.x}:${position.y}`;

/**
 * First free slot on the project canvas. The query is deliberately
 * project-wide instead of type-scoped: every workload type shares one
 * canvas, so their default positions must not overlap.
 */
export const nextWorkloadPosition = async (
  db: Database,
  projectId: string,
): Promise<WorkloadPosition> => {
  const rows = await db
    .select({ position: workload.position })
    .from(workload)
    .where(eq(workload.project_id, projectId));
  const occupied = new Set(rows.map((row) => positionKey(row.position)));
  let index = 0;

  while (occupied.has(positionKey(gridPosition(index)))) {
    index += 1;
  }

  return gridPosition(index);
};

export const normalizeWorkloadPosition = (
  position: unknown,
): WorkloadPosition => {
  const candidate = position as Partial<WorkloadPosition> | null | undefined;
  const x = candidate?.x;
  const y = candidate?.y;

  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y)
  ) {
    throw new BadRequestException('position must contain numeric x and y');
  }

  return { x, y };
};
