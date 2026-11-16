import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { filter, Subject, type Observable } from 'rxjs';
import type { ProjectAccessLevel } from '@acceleratio/shared';
import { DATABASE } from '@/vendor/db/database.constants';
import type { Database } from '@/vendor/db/database.constants';
import type { Access } from './access';
import { customRoleProject, member } from './schemas/member.schema';

@Injectable()
export class AccessService {
  private readonly changed$ = new Subject<string>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Always from the database: the session cookie cache would keep a removed
   * or demoted account's old access for minutes.
   */
  async resolve(userId: string): Promise<Access | null> {
    const rows = await this.db
      .select({
        role: member.role,
        roleId: member.role_id,
        projectId: customRoleProject.project_id,
        level: customRoleProject.access,
      })
      .from(member)
      .leftJoin(
        customRoleProject,
        eq(customRoleProject.role_id, member.role_id),
      )
      .where(eq(member.user_id, userId));

    if (rows.length === 0) {
      return null;
    }

    const { role, roleId } = rows[0];
    const projects =
      role === 'custom' ? new Map<string, ProjectAccessLevel>() : null;

    for (const row of rows) {
      if (projects && row.projectId && row.level) {
        projects.set(row.projectId, row.level);
      }
    }

    return { userId, role, roleId, projects };
  }

  /** Tells open terminals and live streams that these accounts' access changed. */
  notify(userIds: Iterable<string>): void {
    for (const userId of userIds) {
      this.changed$.next(userId);
    }
  }

  changes(): Observable<string> {
    return this.changed$.asObservable();
  }

  /** Emits when this account's access changes; use with `takeUntil`. */
  revoked(userId: string): Observable<string> {
    return this.changed$.pipe(filter((id) => id === userId));
  }
}
