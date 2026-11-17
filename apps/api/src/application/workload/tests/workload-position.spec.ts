import type { WorkloadPosition } from '@acceleratio/shared';
import type { Database } from '@/vendor/db/database.constants';
import { insertAtNextPosition } from '../workload-position';

/** A project whose rows `nextWorkloadPosition` reads; inserts land a tick later. */
const project = () => {
  const rows: { position: WorkloadPosition }[] = [];
  const db = {
    select: () => ({
      from: () => ({ where: () => Promise.resolve([...rows]) }),
    }),
  } as unknown as Database;
  const insert = async (position: WorkloadPosition) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    rows.push({ position });
    return position;
  };
  return { db, insert };
};

describe('insertAtNextPosition', () => {
  it('gives creates that run at once different slots', async () => {
    const { db, insert } = project();

    const positions = await Promise.all([
      insertAtNextPosition(db, 'p1', insert),
      insertAtNextPosition(db, 'p1', insert),
      insertAtNextPosition(db, 'p1', insert),
    ]);

    expect(positions).toEqual([
      { x: 0, y: 0 },
      { x: 320, y: 0 },
      { x: 640, y: 0 },
    ]);
  });

  it('lets the next create run after one fails', async () => {
    const { db, insert } = project();

    const [failed, placed] = await Promise.allSettled([
      insertAtNextPosition(db, 'p1', () => Promise.reject(new Error('taken'))),
      insertAtNextPosition(db, 'p1', insert),
    ]);

    expect(failed.status).toBe('rejected');
    expect(placed).toEqual({ status: 'fulfilled', value: { x: 0, y: 0 } });
  });
});
