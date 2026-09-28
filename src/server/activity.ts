/**
 * Cross-project activity for the global run indicator. Membership-filtered like every other list.
 */
import { prisma } from '@/lib/prisma';
import type { SessionUser } from '@/auth/session';

const ACTIVE = [
  'VALIDATING',
  'QUEUED',
  'PREPARING_CONTEXT',
  'GENERATING_PERSONAS',
  'INDEPENDENT_ASSESSMENT',
  'CONSUMER_REACTION',
  'CROSS_EXAMINATION',
  'REVISION',
  'SYNTHESIS',
  'REPORT',
] as const;

export interface ActivitySummary {
  activeRuns: { id: string; projectId: string; projectName: string; status: string; isMock: boolean }[];
  ingesting: number;
  checkedAt: string;
}

export async function activeRunsFor(user: SessionUser): Promise<ActivitySummary> {
  const memberships = await prisma.projectMember.findMany({
    where: { userId: user.userId, project: { archivedAt: null } },
    select: { projectId: true },
  });
  const ids = memberships.map((m) => m.projectId);
  if (ids.length === 0) return { activeRuns: [], ingesting: 0, checkedAt: new Date().toISOString() };

  const [runs, ingesting] = await Promise.all([
    prisma.run.findMany({
      where: { projectId: { in: ids }, status: { in: [...ACTIVE] } },
      select: { id: true, projectId: true, status: true, isMock: true, project: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.datasetVersion.count({
      where: {
        status: { in: ['UPLOADING', 'SCANNING', 'PARSING', 'PROFILING', 'MAPPING', 'VALIDATING', 'DETECTING_SENSITIVE'] },
        dataset: { projects: { some: { projectId: { in: ids } } } },
      },
    }),
  ]);
  return {
    activeRuns: runs.map((r) => ({ id: r.id, projectId: r.projectId, projectName: r.project.name, status: r.status, isMock: r.isMock })),
    ingesting,
    checkedAt: new Date().toISOString(),
  };
}
