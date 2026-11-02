import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { WorkloadType } from '@acceleratio/shared';
import { and, eq } from 'drizzle-orm';
import { workload } from '@/application/workload/schemas/workload.schema';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';

/**
 * The only shared row lookup: which type a workload belongs to. CRUD stays in
 * the type services, so the facade can dispatch without knowing their tables.
 */
@Injectable()
export class WorkloadTypeResolver {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async resolve(projectId: string, id: string): Promise<WorkloadType> {
    const [row] = await this.db
      .select({ type: workload.type })
      .from(workload)
      .where(and(eq(workload.id, id), eq(workload.project_id, projectId)))
      .limit(1);

    if (!row) {
      throw new NotFoundException('Workload not found');
    }

    return row.type;
  }
}
